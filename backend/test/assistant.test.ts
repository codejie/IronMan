import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ApiResponse<T> {
  code: number;
  result: T;
}
interface Session {
  token: string;
}
let tempDirectory = "";
let runtime: IronManRuntime;
beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-assistant-"));
  runtime = createApp({
    databasePath: join(tempDirectory, "ironman.sqlite"),
    jwtSecret: "test-secret-that-is-long-enough",
    tokenTtlSeconds: 3600,
  });
});
afterEach(() => {
  runtime.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});
async function post(
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return runtime.app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}
async function register(email: string): Promise<Session> {
  const response = await post("/api/auth/register", {
    email,
    password: "a-strong-test-password",
    displayName: email.split("@")[0],
  });
  return ((await response.json()) as ApiResponse<Session>).result;
}

describe("AI consultation", () => {
  test("answers with the current user's local workspace summary without exposing another user", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    await post(
      "/api/assets/cash/adjust",
      { amount: 8888, note: "资金" },
      alice.token,
    );
    await post(
      "/api/assets/cash/adjust",
      { amount: 1234, note: "资金" },
      bob.token,
    );

    const answer = await post(
      "/api/assistant/chat",
      { message: "请总结我的资产" },
      alice.token,
    );
    const body = (await answer.json()) as ApiResponse<{
      content: string;
      provider: string;
      tools: unknown[];
      charts: unknown[];
    }>;
    expect(answer.status).toBe(200);
    expect(body.result.provider).toBe("local");
    expect(body.result.content).toContain("8888");
    expect(body.result.content).not.toContain("1234");
    expect(body.result.tools).toEqual([]);
    expect(body.result.charts).toEqual([]);
  });

  test("persists AI conversations per user and rejects another user's conversation", async () => {
    const alice = await register("conversation-alice@example.com");
    const bob = await register("conversation-bob@example.com");
    const created = await post(
      "/api/assistant/conversations/create",
      {},
      alice.token,
    );
    const conversation = (await created.json()) as ApiResponse<{
      id: string;
      messages: unknown[];
    }>;
    expect(created.status).toBe(201);
    expect(conversation.result.messages).toEqual([]);

    const answer = await post(
      "/api/assistant/chat",
      { message: "请总结我的资产", conversationId: conversation.result.id },
      alice.token,
    );
    const answerBody = (await answer.json()) as ApiResponse<{
      conversation: { id: string; title: string };
      userMessage: { role: string };
      assistantMessage: { role: string };
    }>;
    expect(answer.status).toBe(200);
    expect(answerBody.result.conversation.id).toBe(conversation.result.id);
    expect(answerBody.result.conversation.title).toContain("请总结我的资产");
    expect(answerBody.result.userMessage.role).toBe("user");
    expect(answerBody.result.assistantMessage.role).toBe("assistant");

    const list = await post(
      "/api/assistant/conversations/list",
      {},
      alice.token,
    );
    const listBody = (await list.json()) as ApiResponse<{
      items: Array<{ id: string; lastMessagePreview: string | null }>;
    }>;
    expect(listBody.result.items[0]).toEqual(
      expect.objectContaining({ id: conversation.result.id }),
    );
    expect(listBody.result.items[0]?.lastMessagePreview).toContain("当前账户");

    const detail = await post(
      "/api/assistant/conversations/get",
      { id: conversation.result.id },
      alice.token,
    );
    const detailBody = (await detail.json()) as ApiResponse<{
      messages: Array<{ role: string }>;
    }>;
    expect(detailBody.result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    expect(
      (
        await post(
          "/api/assistant/conversations/get",
          { id: conversation.result.id },
          bob.token,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          "/api/assistant/chat",
          { message: "越权会话", conversationId: conversation.result.id },
          bob.token,
        )
      ).status,
    ).toBe(404);
  });

  test("deletes only the current user's AI conversation and its messages", async () => {
    const alice = await register("delete-conversation-alice@example.com");
    const bob = await register("delete-conversation-bob@example.com");
    const created = await post(
      "/api/assistant/conversations/create",
      {},
      alice.token,
    );
    const conversation = (await created.json()) as ApiResponse<{ id: string }>;

    expect(
      (
        await post(
          "/api/assistant/chat",
          { message: "请总结我的资产", conversationId: conversation.result.id },
          alice.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await post(
          "/api/assistant/conversations/delete",
          { id: conversation.result.id },
          bob.token,
        )
      ).status,
    ).toBe(404);

    const deleted = await post(
      "/api/assistant/conversations/delete",
      { id: conversation.result.id },
      alice.token,
    );
    expect(deleted.status).toBe(200);
    expect(
      ((await deleted.json()) as ApiResponse<{ deleted: boolean }>).result,
    ).toEqual({ deleted: true });
    expect(
      (
        await post(
          "/api/assistant/conversations/get",
          { id: conversation.result.id },
          alice.token,
        )
      ).status,
    ).toBe(404);
    const list = await post(
      "/api/assistant/conversations/list",
      {},
      alice.token,
    );
    expect(
      ((await list.json()) as ApiResponse<{ items: Array<{ id: string }> }>)
        .result.items,
    ).toEqual([]);
  });

  test("passes recent conversation messages to a configured remote model", async () => {
    const alice = await register("conversation-context@example.com");
    await post(
      "/api/settings/ai/update",
      {
        systemPrompt: "自定义系统提示词：先调用本地工具，再提供条件化结论。",
        models: [
          {
            id: "context-model",
            name: "上下文模型",
            provider: "ollama",
            baseUrl: "http://context.local/v1",
            model: "context-test",
            enabled: true,
            default: true,
          },
        ],
      },
      alice.token,
    );
    const created = await post(
      "/api/assistant/conversations/create",
      {},
      alice.token,
    );
    const conversation = (await created.json()) as ApiResponse<{ id: string }>;
    const requestMessages: Array<Array<{ role: string; content: string }>> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      _input: URL | RequestInfo,
      init?: RequestInit,
    ) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        messages: Array<{ role: string; content: string }>;
      };
      requestMessages.push(body.messages);
      return Response.json({
        choices: [
          {
            message: {
              content:
                requestMessages.length === 1 ? "第一轮回答" : "第二轮回答",
            },
          },
        ],
      });
    }) as typeof fetch;
    try {
      expect(
        (
          await post(
            "/api/assistant/chat",
            { message: "第一轮问题", conversationId: conversation.result.id },
            alice.token,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await post(
            "/api/assistant/chat",
            { message: "第二轮问题", conversationId: conversation.result.id },
            alice.token,
          )
        ).status,
      ).toBe(200);
      expect(requestMessages).toHaveLength(2);
      expect(requestMessages[0]?.[0]).toEqual({
        role: "system",
        content: "自定义系统提示词：先调用本地工具，再提供条件化结论。",
      });
      expect(requestMessages[1]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "第一轮问题" }),
          expect.objectContaining({ role: "assistant", content: "第一轮回答" }),
          expect.objectContaining({ role: "user", content: "第二轮问题" }),
        ]),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("builds a local K-line and indicator card for a selected instrument", async () => {
    const admin = await register("admin@example.com");
    const alice = await register("alice@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
      admin.token,
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{
      id: string;
    }>;
    await post(
      "/api/settings/data-sources/update",
      { primary: "mock", fallback: "mock" },
      alice.token,
    );

    const answer = await post(
      "/api/assistant/chat",
      { message: "请展示 600000 的 K线和 MACD 走势", autoChart: true },
      alice.token,
    );
    const body = (await answer.json()) as ApiResponse<{
      charts: Array<{
        instrument: { id: string };
        bars: unknown[];
        indicators: Array<{ type: string }>;
      }>;
      tools: Array<{ name: string; status: string }>;
    }>;

    expect(answer.status).toBe(200);
    expect(body.result.charts).toHaveLength(1);
    expect(body.result.charts[0]?.instrument.id).toBe(instrument.result.id);
    expect(body.result.charts[0]?.bars).toHaveLength(180);
    expect(body.result.charts[0]?.indicators.map((item) => item.type)).toEqual([
      "MACD",
    ]);
    expect(body.result.tools).toContainEqual(
      expect.objectContaining({ name: "build_chart", status: "completed" }),
    );
  });

  test("calculates trend indicators and turning points for a local chart request", async () => {
    const admin = await register("trend-tool-admin@example.com");
    const alice = await register("trend-tool-alice@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
      admin.token,
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{
      id: string;
    }>;
    await post(
      "/api/settings/data-sources/update",
      { primary: "mock", fallback: "mock" },
      alice.token,
    );

    const answer = await post(
      "/api/assistant/chat",
      { message: "请标记 600000 的 MACD 拐点并展示图表", autoChart: true },
      alice.token,
    );
    const body = (await answer.json()) as ApiResponse<{
      provider: string;
      content: string;
      tools: Array<{ name: string; status: string }>;
      charts: Array<{
        instrument: { id: string };
        trend?: {
          indicators: Array<{
            indicatorId: string;
            lines: Record<string, Array<number | null>>;
          }>;
          turningPoints: Array<{ indicatorId: string; direction: string }>;
          assessment: { direction: string; risk: { level: string } };
        };
      }>;
    }>;

    expect(answer.status).toBe(200);
    expect(body.result.provider).toBe("local");
    expect(body.result.content).not.toContain("无法标记");
    expect(body.result.tools).toContainEqual(
      expect.objectContaining({ name: "calculate_trend", status: "completed" }),
    );
    expect(body.result.charts[0]?.instrument.id).toBe(instrument.result.id);
    expect(
      body.result.charts[0]?.trend?.indicators.map((item) => item.indicatorId),
    ).toEqual(["MACD"]);
    expect(body.result.charts[0]?.trend?.indicators[0]?.lines).toHaveProperty(
      "dif",
    );
    expect(body.result.charts[0]?.trend?.assessment.risk.level).toMatch(
      /low|medium|high/,
    );
  });

  test("lets an OpenAI-compatible model request controlled trend calculations", async () => {
    const admin = await register("remote-trend-admin@example.com");
    const alice = await register("remote-trend-alice@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
      admin.token,
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{
      id: string;
    }>;
    await post(
      "/api/settings/data-sources/update",
      { primary: "mock", fallback: "mock" },
      alice.token,
    );
    await post(
      "/api/settings/ai/update",
      {
        models: [
          {
            id: "remote-trend",
            name: "趋势工具模型",
            provider: "ollama",
            baseUrl: "http://trend.local/v1",
            model: "trend-test",
            enabled: true,
            default: true,
          },
        ],
      },
      alice.token,
    );

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      _input: URL | RequestInfo,
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        tools?: Array<{ function?: { name?: string } }>;
      };
      callCount += 1;
      if (callCount === 1) {
        expect(
          request.tools?.some(
            (tool) => tool.function?.name === "calculate_trend",
          ),
        ).toBe(true);
        return Response.json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "trend-call",
                    function: {
                      name: "calculate_trend",
                      arguments: JSON.stringify({
                        instrumentId: instrument.result.id,
                        indicators: [{ indicatorId: "MACD" }],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return Response.json({
        choices: [
          { message: { content: "已基于本地趋势工具标记 MACD 拐点。" } },
        ],
      });
    }) as typeof fetch;
    try {
      const answer = await post(
        "/api/assistant/chat",
        { message: "标记 MACD 拐点", modelId: "remote-trend" },
        alice.token,
      );
      const body = (await answer.json()) as ApiResponse<{
        provider: string;
        charts: Array<{
          trend?: { indicators: Array<{ indicatorId: string }> };
        }>;
        tools: Array<{ name: string; status: string }>;
      }>;

      expect(answer.status).toBe(200);
      expect(body.result.provider).toBe("ollama");
      expect(body.result.tools).toContainEqual(
        expect.objectContaining({
          name: "calculate_trend",
          status: "completed",
        }),
      );
      expect(
        body.result.charts[0]?.trend?.indicators.map(
          (item) => item.indicatorId,
        ),
      ).toEqual(["MACD"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses the controlled technical-ranking tool for a local assistant request", async () => {
    const alice = await register("local-ranking@example.com");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      expect(String(input)).toContain("data.10jqka.com.cn/rank/lxsz");
      return new Response(
        "<table><thead><tr><th>股票代码</th><th>股票简称</th><th>连涨天数</th></tr></thead><tbody><tr><td>600000</td><td>浦发银行</td><td>4</td></tr></tbody></table>",
        { headers: { "content-type": "text/html" } },
      );
    }) as typeof fetch;
    try {
      const answer = await post(
        "/api/assistant/chat",
        { message: "请给我连续上涨 3 天的标的" },
        alice.token,
      );
      const body = (await answer.json()) as ApiResponse<{
        provider: string;
        content: string;
        tools: Array<{ name: string; status: string }>;
      }>;

      expect(answer.status).toBe(200);
      expect(body.result.provider).toBe("local");
      expect(body.result.content).toContain("连续上涨");
      expect(body.result.content).toContain("浦发银行(600000)");
      expect(body.result.tools).toContainEqual(
        expect.objectContaining({
          name: "get_technical_ranking",
          status: "completed",
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to the local workspace when a configured remote model is unavailable", async () => {
    const alice = await register("fallback@example.com");
    await post(
      "/api/settings/ai/update",
      {
        models: [
          {
            id: "unavailable",
            name: "不可用测试模型",
            provider: "openai_compatible",
            baseUrl: "http://127.0.0.1:1/v1",
            model: "test-model",
            apiKey: "test-key",
            enabled: true,
            default: true,
          },
        ],
      },
      alice.token,
    );

    const answer = await post(
      "/api/assistant/chat",
      { message: "请总结我的资产", modelId: "unavailable" },
      alice.token,
    );
    const body = (await answer.json()) as ApiResponse<{
      provider: string;
      fallbackReason?: string;
      content: string;
    }>;

    expect(answer.status).toBe(200);
    expect(body.result.provider).toBe("local");
    expect(body.result.fallbackReason).toBeTruthy();
    expect(body.result.content).toContain("当前账户");
  });

  test("lets an OpenAI-compatible model call local tools before returning a chart-backed answer", async () => {
    const admin = await register("tool-admin@example.com");
    const alice = await register("tool-alice@example.com");
    const instrumentResponse = await post(
      "/api/market/instruments/upsert",
      { code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
      admin.token,
    );
    const instrument = (await instrumentResponse.json()) as ApiResponse<{
      id: string;
    }>;
    await post(
      "/api/settings/data-sources/update",
      { primary: "mock", fallback: "mock" },
      alice.token,
    );

    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/v1/technical/ranking")) {
        return Response.json({
          source: "akshare",
          columns: ["代码", "名称", "连涨天数"],
          rows: [{ 代码: "600000", 名称: "浦发银行", 连涨天数: 4 }],
        });
      }
      expect(url).toContain("/v1/chat/completions");
      callCount += 1;
      if (callCount === 1) {
        return Response.json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "tool-resolve",
                    function: {
                      name: "resolve_instrument",
                      arguments: JSON.stringify({ query: "600000" }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      if (callCount === 2) {
        return Response.json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "tool-chart",
                    function: {
                      name: "build_chart",
                      arguments: JSON.stringify({
                        instrumentId: instrument.result.id,
                        indicators: ["MA", "MACD"],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      if (callCount === 3) {
        return Response.json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "tool-ranking",
                    function: {
                      name: "get_technical_ranking",
                      arguments: JSON.stringify({ kind: "uptrend", days: 3 }),
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      return Response.json({
        choices: [
          {
            message: {
              content: "本地行情显示，建议关注均线与 MACD 的同步变化。",
            },
          },
        ],
      });
    }) as typeof fetch;
    try {
      await post(
        "/api/settings/ai/update",
        {
          models: [
            {
              id: "tool-model",
              name: "工具测试模型",
              provider: "ollama",
              baseUrl: "http://tools.local/v1",
              model: "tool-test",
              enabled: true,
              default: true,
            },
          ],
        },
        alice.token,
      );

      const answer = await post(
        "/api/assistant/chat",
        { message: "分析 600000 的趋势", modelId: "tool-model" },
        alice.token,
      );
      const body = (await answer.json()) as ApiResponse<{
        provider: string;
        content: string;
        charts: Array<{ instrument: { id: string } }>;
        tools: Array<{ name: string; status: string }>;
      }>;

      expect(answer.status).toBe(200);
      expect(body.result.provider).toBe("ollama");
      expect(body.result.content).toContain("MACD");
      expect(body.result.charts[0]?.instrument.id).toBe(instrument.result.id);
      expect(body.result.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "resolve_instrument",
            status: "completed",
          }),
          expect.objectContaining({ name: "build_chart", status: "completed" }),
          expect.objectContaining({
            name: "get_technical_ranking",
            status: "completed",
          }),
        ]),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
