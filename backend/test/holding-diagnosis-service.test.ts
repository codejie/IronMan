import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IronManDatabase } from "../src/db/database";
import type { Instrument, MarketDataProvider } from "../src/market/types";
import { BackupService } from "../src/services/backup-service";
import {
  HoldingDiagnosisService,
  type HoldingDiagnosisModel,
  type HoldingDiagnosisSourceAdapter,
} from "../src/services/holding-diagnosis-service";
import { MarketService } from "../src/services/market-service";
import { SettingsService } from "../src/services/settings-service";
import { TradingCalendarService } from "../src/services/trading-calendar-service";
import { TrendIndicatorService } from "../src/services/trend-indicator-service";

let directory = "";
let database: IronManDatabase;
let market: MarketService;
let diagnosis: HoldingDiagnosisService;

const now = new Date("2026-07-31T07:30:00.000Z");

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ironman-holding-diagnosis-"));
  database = new IronManDatabase(join(directory, "ironman.sqlite"));
  const settings = new SettingsService(database);
  const provider: MarketDataProvider = {
    source: "mock",
    history: async (_instrument: Instrument) => [
      { date: "2026-07-28", open: 9.5, close: 9.8, high: 10, low: 9.4, volume: 1200 },
      { date: "2026-07-29", open: 9.8, close: 10.2, high: 10.4, low: 9.7, volume: 1800 },
      { date: "2026-07-30", open: 10.1, close: 10.6, high: 10.8, low: 10, volume: 2200 },
      { date: "2026-07-31", open: 10.5, close: 10.9, high: 11.1, low: 10.3, volume: 2600 },
    ],
  };
  market = new MarketService(database, settings, [provider]);
  diagnosis = new HoldingDiagnosisService(
    database,
    settings,
    market,
    new TrendIndicatorService(),
    new TradingCalendarService(settings),
    model(),
    [sources()],
    () => now,
  );
});

afterEach(() => {
  database.close();
  rmSync(directory, { force: true, recursive: true });
});

function model(body = "趋势转强但仍需观察成交量与公告变化。", withSourceInsight = false) : HoldingDiagnosisModel {
  return {
    generate: async (input) => {
      const local = await input.calculateAlgorithms(input.items[0]!.instrumentId, [
        { indicatorId: "MACD", parameters: { fast: 12, slow: 26, signal: 9 } },
        { indicatorId: "ATR", parameters: { period: 14 } },
      ]);
      return {
        body,
        items: input.items.map((item) => ({
          instrumentId: item.instrumentId,
          analysis: "价格位于近期高位，等待量能与趋势进一步确认。",
          recommendation: {
            direction: "observe",
            timing: "下一交易日确认后",
            referencePriceLow: 10.6,
            referencePriceHigh: 11.1,
            invalidationPrice: 10.2,
            validUntil: "2026-08-07",
            uncertainty: "行情样本较短，需结合后续成交量。",
          },
          methods: [
            { kind: "ai_analysis", name: "模型趋势判断", rationale: "比较价格、持仓成本和近期波动。" },
            ...local.methods,
          ],
          sourceInsights: withSourceInsight ? [{
            sourceId: "cninfo",
            summary: "公告披露公司拟回购股份，回购规模和期限以公告正文为准。",
            keyFacts: ["拟回购股份", "资金安排待继续核验"],
            marketImpact: "positive" as const,
            confidence: "high" as const,
          }] : undefined,
        })),
      };
    },
  };
}

function sources(): HoldingDiagnosisSourceAdapter {
  return {
    id: "cninfo",
    label: "巨潮资讯",
    async collect(instrument) {
      return [{
        sourceId: "cninfo",
        sourceName: "巨潮资讯",
        type: "disclosure",
        title: `${instrument.name} 最新公告`,
      publishedAt: "2026-07-31T06:00:00.000Z",
      url: `https://www.cninfo.com.cn/new/commonUrl?url=disclosure/list/notice&code=${instrument.code}`,
      summary: `${instrument.name} 的公告检索已就绪，本次未读取公告正文。`,
      highlights: ["披露范围：定期报告、临时公告", "状态：仅保留检索摘要"],
      transientText: "公告摘要仅用于本次生成，不能写入数据库。",
      }];
    },
  };
}

function createUser(email: string): string {
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  database.run(
    `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
     VALUES ($id, $email, 'not-used', $displayName, 'user', 'active', $createdAt, $updatedAt)`,
    { id, email, displayName: email.split("@")[0]!, createdAt: timestamp, updatedAt: timestamp },
  );
  market.setDataSourceConfig(id, { primary: "mock", fallback: "mock" });
  return id;
}

function addHolding(userId: string, code = "600000"): string {
  const instrument = market.upsertInstrument({
    code,
    exchange: "sh",
    name: "诊断测试股票",
    assetType: "stock",
  });
  database.run(
    "INSERT INTO holdings (id, user_id, instrument_id, status, created_at, updated_at) VALUES ($id, $userId, $instrumentId, 'active', $createdAt, $updatedAt)",
    { id: crypto.randomUUID(), userId, instrumentId: instrument.id, createdAt: now.toISOString(), updatedAt: now.toISOString() },
  );
  database.run(
    "INSERT INTO holding_transactions (id, user_id, holding_id, action, quantity, price, fee, note, occurred_at, created_at) VALUES ($id, $userId, $holdingId, 'buy', 100, 10, 0, '', $occurredAt, $createdAt)",
    {
      id: crypto.randomUUID(),
      userId,
      holdingId: database.get<{ id: string }>("SELECT id FROM holdings WHERE user_id = $userId AND instrument_id = $instrumentId", { userId, instrumentId: instrument.id })!.id,
      occurredAt: now.toISOString(),
      createdAt: now.toISOString(),
    },
  );
  return instrument.id;
}

describe("holding diagnosis reports", () => {
  test("persists a compact report, local method disclosure, chart data, and source summaries without raw source text", async () => {
    const userId = createUser("diagnosis@example.com");
    addHolding(userId);

    const run = await diagnosis.generate(userId, "manual");
    const report = diagnosis.getReport(userId, run.reportId!);

    expect(run.status).toBe("completed");
    expect(report.body.length).toBeLessThanOrEqual(600);
    expect(report.body).toBe("已完成 1/1 个持仓诊断。");
    expect(report.items).toHaveLength(1);
    expect(report.items[0]!.body).toBe("趋势转强但仍需观察成交量与公告变化。");
    expect(report.items[0]!.body.length).toBeLessThanOrEqual(600);
    expect(report.items[0]!.chart.bars).toHaveLength(4);
    expect(report.items[0]!.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "ai_analysis", name: "模型趋势判断" }),
        expect.objectContaining({ kind: "local_function", name: "MACD", parameters: { fast: 12, slow: 26, signal: 9 } }),
      ]),
    );
    expect(report.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: "cninfo",
          url: expect.stringContaining("cninfo.com.cn"),
          summary: expect.stringContaining("未读取公告正文"),
          highlights: ["披露范围：定期报告、临时公告", "状态：仅保留检索摘要"],
        }),
      ]),
    );
    expect(database.get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'holding_diagnosis_sources'")?.sql).not.toContain("transient_text");
    expect(database.get<{ metadata_json: string }>("SELECT metadata_json FROM holding_diagnosis_sources LIMIT 1")?.metadata_json).not.toContain("公告摘要仅用于本次生成");

    database.run("UPDATE holding_diagnosis_sources SET metadata_json = '{}' WHERE report_id = $reportId", { reportId: run.reportId! });
    const compatibleReport = diagnosis.getReport(userId, run.reportId!);
    expect(compatibleReport.sources[0]).toEqual(expect.objectContaining({
      summary: expect.stringContaining("本次未读取站外正文"),
      highlights: expect.arrayContaining(["状态：仅提供跳转入口，需自行核验"]),
    }));

    const exported = new BackupService(database).exportUserData(userId);
    expect(exported.data.holding_diagnosis_reports).toHaveLength(1);
    expect(exported.data.holding_diagnosis_sources?.[0]).toEqual(
      expect.not.objectContaining({ transientText: expect.anything() }),
    );
  });

  test("processes holdings sequentially and persists the previous item before starting the next one", async () => {
    const userId = createUser("sequential-diagnosis@example.com");
    const firstInstrumentId = addHolding(userId, "600010");
    const secondInstrumentId = addHolding(userId, "600011");
    const events: string[] = [];
    let calls = 0;
    const settings = new SettingsService(database);
    diagnosis = new HoldingDiagnosisService(
      database,
      settings,
      market,
      new TrendIndicatorService(),
      new TradingCalendarService(settings),
      {
        generate: async (input) => {
          calls += 1;
          expect(input.items).toHaveLength(1);
          const item = input.items[0]!;
          const persistedCount = database.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM holding_diagnosis_items",
          )?.count ?? 0;
          events.push(`${item.instrumentId}:${persistedCount}`);
          return {
            body: `${item.name} 的逐标的诊断。`,
            items: [{
              instrumentId: item.instrumentId,
              analysis: `${item.name} 的独立分析。`,
              recommendation: {
                direction: "observe" as const,
                timing: "下一交易日确认后",
                referencePriceLow: item.currentPrice,
                referencePriceHigh: item.currentPrice,
                invalidationPrice: null,
                validUntil: null,
                uncertainty: "逐标的测试结果需继续复核。",
              },
            }],
          };
        },
      },
      [sources()],
      () => now,
    );

    const run = await diagnosis.generate(userId, "manual");
    const report = diagnosis.getReport(userId, run.reportId!);

    expect(calls).toBe(2);
    expect(events).toEqual([
      `${firstInstrumentId}:0`,
      `${secondInstrumentId}:1`,
    ]);
    expect(report.items).toHaveLength(2);
    expect(report.body).toBe("已完成 2/2 个持仓诊断。");
    expect(report.body).not.toContain("独立分析");
    expect(report.items.every((item) => item.body.length <= 600)).toBe(true);
    expect(run.status).toBe("completed");
  });

  test("stores AI source insights and source metadata without transient正文", async () => {
    const userId = createUser("source-insight@example.com");
    addHolding(userId);
    diagnosis = new HoldingDiagnosisService(
      database,
      new SettingsService(database),
      market,
      new TrendIndicatorService(),
      new TradingCalendarService(new SettingsService(database)),
      model("来源洞察测试", true),
      [sources()],
      () => now,
    );

    const run = await diagnosis.generate(userId, "manual");
    const report = diagnosis.getReport(userId, run.reportId!);
    const source = report.sources.find((item) => item.sourceId === "cninfo");

    expect(source).toEqual(expect.objectContaining({
      summaryKind: "ai",
      summary: expect.stringContaining("拟回购股份"),
      sourceInsight: expect.objectContaining({ marketImpact: "positive", confidence: "high" }),
    }));
    expect(database.get<{ source_insight_json: string; metadata_json: string }>("SELECT source_insight_json, metadata_json FROM holding_diagnosis_sources LIMIT 1")).toEqual(
      expect.objectContaining({
        source_insight_json: expect.stringContaining("拟回购股份"),
      }),
    );
    expect(database.get<{ metadata_json: string }>("SELECT metadata_json FROM holding_diagnosis_sources LIMIT 1")?.metadata_json).not.toContain("公告摘要仅用于本次生成");
  });

  test("isolates an AI failure to one holding and continues the queue", async () => {
    const userId = createUser("partial-diagnosis@example.com");
    addHolding(userId, "600012");
    addHolding(userId, "600013");
    const settings = new SettingsService(database);
    let calls = 0;
    diagnosis = new HoldingDiagnosisService(
      database,
      settings,
      market,
      new TrendIndicatorService(),
      new TradingCalendarService(settings),
      {
        generate: async (input) => {
          calls += 1;
          const item = input.items[0]!;
          if (calls === 1) throw new Error("AI 服务返回 503");
          return {
            body: "第二个标的已完成 AI 诊断。",
            items: [{
              instrumentId: item.instrumentId,
              analysis: "第二个标的完成独立分析。",
              recommendation: {
                direction: "hold" as const,
                timing: "等待趋势确认",
                referencePriceLow: item.currentPrice,
                referencePriceHigh: item.currentPrice,
                invalidationPrice: null,
                validUntil: null,
                uncertainty: "仍需结合后续行情复核。",
              },
            }],
          };
        },
        getModelSnapshot: () => ({ id: "remote", name: "远程测试模型", provider: "deepseek" }),
      },
      [sources()],
      () => now,
    );

    const run = await diagnosis.generate(userId, "manual");
    const report = diagnosis.getReport(userId, run.reportId!);

    expect(calls).toBe(2);
    expect(run.status).toBe("partial");
    expect(run.errorMessage).toContain("503");
    expect(report.items).toHaveLength(2);
    const failedItem = report.items.find((item) => item.errorMessage?.includes("503"));
    const completedItem = report.items.find((item) => item.errorMessage === null);
    expect(failedItem?.dataQuality).toBe("partial");
    expect(failedItem?.errorMessage).toContain("503");
    expect(failedItem?.methods).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "ai_analysis" })]),
    );
    expect(completedItem?.methods).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "ai_analysis" })]),
    );
  });

  test("keeps reports isolated and supports current-user batch deletion", async () => {
    const alice = createUser("alice-diagnosis@example.com");
    const bob = createUser("bob-diagnosis@example.com");
    addHolding(alice, "600001");
    addHolding(bob, "600002");

    const aliceRun = await diagnosis.generate(alice, "manual");
    const bobRun = await diagnosis.generate(bob, "manual");

    expect(diagnosis.listReports(alice).items).toHaveLength(1);
    expect(diagnosis.listReports(bob).items).toHaveLength(1);
    expect(() => diagnosis.getReport(alice, bobRun.reportId!)).toThrow("持仓诊断报告不存在");
    expect(diagnosis.deleteReports(alice, { reportIds: [aliceRun.reportId!] })).toEqual({ deleted: 1 });
    expect(diagnosis.listReports(alice).items).toHaveLength(0);
    expect(diagnosis.listReports(bob).items).toHaveLength(1);
  });

  test("clears only the current user's report archive and keeps report-less runs", async () => {
    const alice = createUser("alice-clear-diagnosis@example.com");
    const bob = createUser("bob-clear-diagnosis@example.com");
    addHolding(alice, "600006");
    addHolding(bob, "600007");

    const aliceReport = await diagnosis.generate(alice, "manual");
    const bobReport = await diagnosis.generate(bob, "manual");
    const inProgressRunId = crypto.randomUUID();
    const timestamp = now.toISOString();
    database.run(
      `INSERT INTO holding_diagnosis_runs (
        id, user_id, trigger, status, progress, scheduled_trade_date, settings_snapshot_json,
        model_snapshot_json, created_at, updated_at
      ) VALUES ($id, $userId, 'manual', 'running', 35, NULL, '{}', '{}', $createdAt, $updatedAt)`,
      { id: inProgressRunId, userId: alice, createdAt: timestamp, updatedAt: timestamp },
    );

    expect(diagnosis.deleteAllReports(alice)).toEqual({ deleted: 1 });
    expect(diagnosis.listReports(alice).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: inProgressRunId, reportId: null, status: "running" })]),
    );
    expect(() => diagnosis.getReport(alice, aliceReport.reportId!)).toThrow("持仓诊断报告不存在");
    expect(diagnosis.getReport(bob, bobReport.reportId!)).toEqual(expect.objectContaining({ id: bobReport.reportId }));
  });

  test("marks overly long AI text partial while retaining the local diagnosis", async () => {
    const userId = createUser("long-diagnosis@example.com");
    addHolding(userId, "600003");
    diagnosis = new HoldingDiagnosisService(
      database,
      new SettingsService(database),
      market,
      new TrendIndicatorService(),
      new TradingCalendarService(new SettingsService(database)),
      model("过".repeat(601)),
      [sources()],
      () => now,
    );

    const run = await diagnosis.generate(userId, "manual");
    const report = diagnosis.getReport(userId, run.reportId!);

    expect(run.status).toBe("partial");
    expect(report.body.length).toBeLessThanOrEqual(600);
    expect(report.items[0]!.body.length).toBeLessThanOrEqual(600);
    expect(report.items[0]!.body).toContain("已整理");
    expect(report.errorMessage).toContain("600");
  });

  test("marks an AI timeout as a user-readable local fallback without presenting it as AI analysis", async () => {
    const userId = createUser("timeout-diagnosis@example.com");
    addHolding(userId, "600005");
    diagnosis = new HoldingDiagnosisService(
      database,
      new SettingsService(database),
      market,
      new TrendIndicatorService(),
      new TradingCalendarService(new SettingsService(database)),
      {
        generate: async () => {
          throw new Error("AI 持仓诊断请求超时（90 秒）");
        },
        getModelSnapshot: () => ({ id: "slow-ollama", name: "慢速模型", provider: "ollama" }),
      },
      [sources()],
      () => now,
    );

    const run = await diagnosis.generate(userId, "manual");
    const report = diagnosis.getReport(userId, run.reportId!);

    expect(run.status).toBe("partial");
    expect(run.errorMessage).toContain("已使用本地行情与指标摘要");
    expect(run.errorMessage).not.toContain("The operation timed out");
    expect(report.aiStatus).toEqual(expect.objectContaining({
      state: "timeout",
      model: expect.objectContaining({ name: "慢速模型" }),
    }));
    expect(report.items[0]?.methods).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "local_function", name: "本地行情与指标摘要" })]),
    );
    expect(report.items[0]?.methods).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "ai_analysis" })]),
    );
  });

  test("deduplicates the daily scheduled report and marks a failed external source partial", async () => {
    const userId = createUser("scheduled-diagnosis@example.com");
    addHolding(userId, "600004");
    const failingSource: HoldingDiagnosisSourceAdapter = {
      id: "unavailable-news",
      label: "不可用资料源",
      fallbackUrl: "https://example.com/finance",
      async collect() {
        throw new Error("upstream unavailable");
      },
    };
    const settings = new SettingsService(database);
    diagnosis = new HoldingDiagnosisService(
      database,
      settings,
      market,
      new TrendIndicatorService(),
      new TradingCalendarService(settings),
      model(),
      [failingSource],
      () => now,
    );
    diagnosis.updateSettings(userId, {
      enabled: true,
      sourceIds: ["unavailable-news"],
    });

    await diagnosis.runDueAutomatic(now);
    await diagnosis.runDueAutomatic(now);
    await Bun.sleep(0);

    const runs = database.all<{ id: string }>(
      "SELECT id FROM holding_diagnosis_runs WHERE user_id = $userId AND trigger = 'scheduled'",
      { userId },
    );
    expect(runs).toHaveLength(1);
    const run = diagnosis.getRun(userId, runs[0]!.id);
    const report = diagnosis.getReport(userId, run.reportId!);
    expect(run.status).toBe("partial");
    expect(run.errorMessage).toContain("资料源");
    expect(report.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "unavailable-news", availability: "failed", url: "https://example.com/finance" }),
      ]),
    );
  });
});
