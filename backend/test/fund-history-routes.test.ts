import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ApiResponse<T> {
  code: number;
  message?: string;
  result: T;
}

interface Session {
  token: string;
  user: { id: string; role: "admin" | "user" };
}

let tempDirectory = "";
let runtime: IronManRuntime;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-fund-history-routes-"));
  runtime = createApp({
    databasePath: join(tempDirectory, "ironman.sqlite"),
    jwtSecret: "test-secret-that-is-long-enough",
    tokenTtlSeconds: 60 * 60,
  });
});

afterEach(() => {
  runtime.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});

async function post(path: string, body: unknown, token?: string): Promise<Response> {
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

describe("fund history routes", () => {
  test("generates history on demand and keeps derived records isolated by user", async () => {
    const alice = await register("alice-funds@example.com");
    const bob = await register("bob-funds@example.com");
    const today = shanghaiDate();
    const year = Number(today.slice(0, 4));

    await post(
      "/api/settings/trading-calendar/update",
      { year, tradeDays: [today] },
      alice.token,
    );
    await post("/api/assets/cash/adjust", { amount: 100_000, note: "初始资金" }, alice.token);

    const history = await post(
      "/api/assets/funds/history",
      { startDate: today, endDate: today },
      alice.token,
    );
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as ApiResponse<{
      summary: { totalAssets: number; principal: number };
      points: Array<{ tradeDate: string; totalAssets: number; dataStatus: string }>;
      state: { tradeDayCount: number; status: string };
    }>;
    expect(historyBody.result.summary).toMatchObject({ totalAssets: 100_000, principal: 100_000 });
    expect(historyBody.result.points).toEqual([
      expect.objectContaining({ tradeDate: today, totalAssets: 100_000, dataStatus: "complete" }),
    ]);
    expect(historyBody.result.state).toMatchObject({ tradeDayCount: 1, status: "idle" });

    const bobStatus = await post("/api/assets/funds/history/status", {}, bob.token);
    expect(bobStatus.status).toBe(200);
    const bobBody = (await bobStatus.json()) as ApiResponse<{ tradeDayCount: number }>;
    expect(bobBody.result.tradeDayCount).toBe(0);
  });

  test("rejects ranges beyond one year and supports an explicit rebuild", async () => {
    const user = await register("rebuild-funds@example.com");
    const invalid = await post(
      "/api/assets/funds/history",
      { startDate: "2025-01-01", endDate: "2026-01-02" },
      user.token,
    );
    expect(invalid.status).toBe(400);

    const future = await post(
      "/api/assets/funds/history",
      { startDate: "2099-01-01", endDate: "2099-01-31" },
      user.token,
    );
    expect(future.status).toBe(400);

    const rebuilt = await post("/api/assets/funds/history/recalculate", {}, user.token);
    expect(rebuilt.status).toBe(200);
    const rebuiltBody = (await rebuilt.json()) as ApiResponse<{
      points: unknown[];
      state: { status: string; tradeDayCount: number };
    }>;
    expect(rebuiltBody.result.points).toEqual([]);
    expect(rebuiltBody.result.state).toMatchObject({ status: "idle", tradeDayCount: 0 });
  });
});

function shanghaiDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
