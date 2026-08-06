import { z } from "@hono/zod-openapi";
import { IronManDatabase } from "../db/database";
import { errors } from "../errors";
import { listedFundExchange } from "../market/listed-fund";
import type { Instrument, MarketSource, PriceBar } from "../market/types";
import { MarketService } from "./market-service";
import { SettingsService } from "./settings-service";
import { TradingCalendarService } from "./trading-calendar-service";
import {
  normalizeTrendIndicators,
  TrendIndicatorService,
  type TrendIndicatorResult,
  type TrendIndicatorSelection,
  type TrendTurningPoint,
} from "./trend-indicator-service";

export type HoldingDiagnosisTrigger = "manual" | "scheduled";
export type HoldingDiagnosisStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export type HoldingRecommendationDirection = "add_evaluation" | "reduce_evaluation" | "hold" | "observe" | "research_further";
export type HoldingDiagnosisMethodKind =
  | "ai_analysis"
  | "local_function"
  | "hybrid_analysis";
export type HoldingDiagnosisSourceType = "market" | "disclosure" | "news" | "reference";
export type HoldingDiagnosisSourceAvailability = "available" | "stale" | "failed" | "link_only";
export type HoldingDiagnosisAiStatusState = "completed" | "local" | "timeout" | "unavailable";

export interface HoldingDiagnosisSettings {
  enabled: boolean;
  scheduledTime: string;
  sourceIds: string[];
  reportPreference: string;
  lookbackTradingDays: 20 | 60 | 120;
  maxFunctionBatches: 1 | 2 | 3;
  maxExternalSourcesPerHolding: 1 | 3 | 5;
}

export interface HoldingDiagnosisMethod {
  kind: HoldingDiagnosisMethodKind;
  name: string;
  version?: string;
  parameters?: Record<string, number>;
  dataWindow?: number;
  rationale: string;
  limitations?: string;
}

export interface HoldingDiagnosisRecommendation {
  direction: HoldingRecommendationDirection;
  timing: string;
  referencePriceLow: number | null;
  referencePriceHigh: number | null;
  invalidationPrice: number | null;
  validUntil: string | null;
  uncertainty: string;
}

export interface HoldingDiagnosisTurningPoint {
  date: string;
  direction: "bullish" | "bearish";
  price: number | null;
  title: string;
  reason: string;
  methods: HoldingDiagnosisMethod[];
}

export interface HoldingDiagnosisChart {
  bars: PriceBar[];
  source: MarketSource;
  indicators: TrendIndicatorResult[];
  turningPoints: HoldingDiagnosisTurningPoint[];
}

export interface HoldingDiagnosisItem {
  id: string;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
  quantity: number;
  averageCost: number | null;
  currentPrice: number | null;
  profit: number | null;
  dataQuality: "complete" | "partial" | "stale" | "unavailable";
  analysis: string;
  methods: HoldingDiagnosisMethod[];
  recommendation: HoldingDiagnosisRecommendation;
  chart: HoldingDiagnosisChart;
}

export interface HoldingDiagnosisSource {
  id: string;
  sourceId: string;
  sourceName: string;
  type: HoldingDiagnosisSourceType;
  title: string;
  publishedAt: string | null;
  fetchedAt: string;
  availability: HoldingDiagnosisSourceAvailability;
  url: string;
  itemId: string | null;
  summary: string | null;
  highlights: string[];
}

export interface HoldingDiagnosisModelSnapshot {
  id: string;
  name: string;
  provider: string;
}

export interface HoldingDiagnosisAiStatus {
  state: HoldingDiagnosisAiStatusState;
  model: HoldingDiagnosisModelSnapshot;
  message: string;
  timeoutSeconds?: number;
}

export interface HoldingDiagnosisReport {
  id: string;
  runId: string;
  body: string;
  errorMessage: string | null;
  marketAsOf: string | null;
  createdAt: string;
  aiStatus: HoldingDiagnosisAiStatus;
  items: HoldingDiagnosisItem[];
  sources: HoldingDiagnosisSource[];
}

export interface HoldingDiagnosisRun {
  id: string;
  trigger: HoldingDiagnosisTrigger;
  status: HoldingDiagnosisStatus;
  progress: number;
  scheduledTradeDate: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  reportId: string | null;
}

export interface HoldingDiagnosisSourceRecord {
  sourceId: string;
  sourceName: string;
  type: HoldingDiagnosisSourceType;
  title: string;
  publishedAt?: string | null;
  url: string;
  availability?: HoldingDiagnosisSourceAvailability;
  summary?: string;
  highlights?: string[];
  transientText?: string;
}

export interface HoldingDiagnosisSourceAdapter {
  id: string;
  label: string;
  description?: string;
  fallbackUrl?: string;
  collect(instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">): Promise<HoldingDiagnosisSourceRecord[]>;
}

export interface HoldingDiagnosisLocalAlgorithmResult {
  methods: HoldingDiagnosisMethod[];
  indicators: TrendIndicatorResult[];
  turningPoints: HoldingDiagnosisTurningPoint[];
}

export interface HoldingDiagnosisModelInput {
  userId: string;
  reportPreference: string;
  maxFunctionBatches: number;
  items: Array<{
    instrumentId: string;
    name: string;
    code: string;
    quantity: number;
    averageCost: number | null;
    currentPrice: number | null;
    source: MarketSource | null;
    bars: PriceBar[];
    externalSources: HoldingDiagnosisSourceRecord[];
  }>;
  calculateAlgorithms: (instrumentId: string, selections: TrendIndicatorSelection[]) => Promise<HoldingDiagnosisLocalAlgorithmResult>;
}

export interface HoldingDiagnosisModelOutput {
  body: string;
  items: Array<{
    instrumentId: string;
    analysis: string;
    recommendation: HoldingDiagnosisRecommendation;
    methods?: HoldingDiagnosisMethod[];
    turningPoints?: HoldingDiagnosisTurningPoint[];
  }>;
  model?: HoldingDiagnosisModelSnapshot;
}

export interface HoldingDiagnosisModel {
  generate(input: HoldingDiagnosisModelInput): Promise<HoldingDiagnosisModelOutput>;
  getModelSnapshot?(userId: string): HoldingDiagnosisModelSnapshot;
}

export const holdingDiagnosisSettingsSchema = z.object({
  enabled: z.boolean(),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  sourceIds: z.array(z.string().min(1).max(60)).min(1).max(8),
  reportPreference: z.string().trim().max(4_000),
  lookbackTradingDays: z.union([z.literal(20), z.literal(60), z.literal(120)]),
  maxFunctionBatches: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  maxExternalSourcesPerHolding: z.union([z.literal(1), z.literal(3), z.literal(5)]),
});

const settingsKey = "holding.diagnosis";
const defaultSettings: HoldingDiagnosisSettings = {
  enabled: false,
  scheduledTime: "15:30",
  sourceIds: ["all"],
  reportPreference: "优先识别趋势、风险、关键价格与需要确认的信息；给出条件化建议，不承诺收益。",
  lookbackTradingDays: 60,
  maxFunctionBatches: 1,
  maxExternalSourcesPerHolding: 3,
};

interface RunRow {
  id: string;
  trigger: HoldingDiagnosisTrigger;
  status: HoldingDiagnosisStatus;
  progress: number;
  scheduled_trade_date: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface ReportRow {
  id: string;
  run_id: string;
  body: string;
  market_as_of: string | null;
  created_at: string;
  error_message: string | null;
  summary_json: string;
  model_snapshot_json: string;
}

interface ItemRow {
  id: string;
  instrument_id: string;
  data_snapshot_json: string;
  chart_snapshot_json: string;
  analysis_json: string;
  data_quality: HoldingDiagnosisItem["dataQuality"];
}

interface SourceRow {
  id: string;
  source_id: string;
  source_name: string;
  source_type: HoldingDiagnosisSourceType;
  title: string;
  published_at: string | null;
  fetched_at: string;
  availability: HoldingDiagnosisSourceAvailability;
  url: string;
  item_id: string | null;
  metadata_json: string;
}

interface HoldingRow {
  holding_id: string;
  instrument_id: string;
  code: string;
  exchange: Instrument["exchange"];
  name: string;
  asset_type: Instrument["assetType"];
  quantity: number;
  cost: number;
}

export class HoldingDiagnosisService {
  private activeRuns = new Set<string>();

  constructor(
    private readonly database: IronManDatabase,
    private readonly settings: SettingsService,
    private readonly market: MarketService,
    private readonly indicators: TrendIndicatorService,
    private readonly calendar: TradingCalendarService,
    private readonly model: HoldingDiagnosisModel,
    private readonly sources: HoldingDiagnosisSourceAdapter[] = [],
    private readonly clock: () => Date = () => new Date(),
  ) {}

  getSettings(userId: string): HoldingDiagnosisSettings {
    return normalizeSettings(this.settings.get(userId, settingsKey)?.value);
  }

  updateSettings(userId: string, input: Partial<HoldingDiagnosisSettings>): HoldingDiagnosisSettings {
    const next = { ...this.getSettings(userId), ...input };
    validateSettings(next);
    const validSources = new Set([
      "all",
      ...this.sourceCatalog().map((source) => source.id),
    ]);
    if (next.sourceIds.some((sourceId) => !validSources.has(sourceId))) {
      throw errors.validation("持仓诊断资料源不在可用目录中");
    }
    if (next.sourceIds.includes("all") && next.sourceIds.length !== 1) {
      throw errors.validation("选择全部资料源时不能同时指定单独资料源");
    }
    this.settings.upsert(userId, settingsKey, next);
    return next;
  }

  sourceCatalog(): Array<{
    id: string;
    label: string;
    description: string;
    kind: "market" | "external";
  }> {
    return [
      {
        id: "market",
        label: "当前行情主备源",
        description: "复用当前用户配置的 AkShare、腾讯财经或东方财富主备行情与本地缓存。",
        kind: "market" as const,
      },
      ...this.sources.map((source) => ({
        id: source.id,
        label: source.label,
        description: source.description ?? source.label,
        kind: "external" as const,
      })),
    ];
  }

  async generate(userId: string, trigger: HoldingDiagnosisTrigger, scheduledTradeDate: string | null = null): Promise<HoldingDiagnosisRun> {
    const run = this.createRun(userId, trigger, scheduledTradeDate);
    await this.processRun(userId, run.id);
    return this.getRun(userId, run.id);
  }

  start(userId: string, trigger: HoldingDiagnosisTrigger, scheduledTradeDate: string | null = null): HoldingDiagnosisRun {
    const run = this.createRun(userId, trigger, scheduledTradeDate);
    void this.processRun(userId, run.id);
    return run;
  }

  async runDueAutomatic(now = this.clock()): Promise<void> {
    const candidates = this.database.all<{ user_id: string; value_json: string }>(
      "SELECT user_id, value_json FROM user_settings WHERE setting_key = $settingKey",
      { settingKey: settingsKey },
    );
    const local = shanghaiParts(now);
    for (const candidate of candidates) {
      const config = normalizeSettings(parseJson(candidate.value_json));
      if (!config.enabled || local.time < config.scheduledTime) continue;
      if (!this.calendar.getTradeDays(candidate.user_id, local.date, local.date).includes(local.date)) continue;
      const exists = this.database.get<{ id: string }>(
        "SELECT id FROM holding_diagnosis_runs WHERE user_id = $userId AND trigger = 'scheduled' AND scheduled_trade_date = $tradeDate",
        { userId: candidate.user_id, tradeDate: local.date },
      );
      if (exists === undefined) this.start(candidate.user_id, "scheduled", local.date);
    }
  }

  getRun(userId: string, runId: string): HoldingDiagnosisRun {
    const row = this.database.get<RunRow>(
      "SELECT * FROM holding_diagnosis_runs WHERE id = $id AND user_id = $userId",
      { id: runId, userId },
    );
    if (row === undefined) throw errors.notFound("持仓诊断任务不存在");
    const report = this.database.get<{ id: string }>(
      "SELECT id FROM holding_diagnosis_reports WHERE run_id = $runId AND user_id = $userId",
      { runId, userId },
    );
    return {
      id: row.id,
      trigger: row.trigger,
      status: row.status,
      progress: row.progress,
      scheduledTradeDate: row.scheduled_trade_date,
      errorMessage: displayErrorMessage(row.error_message),
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      reportId: report?.id ?? null,
    };
  }

  listReports(userId: string, input: { limit?: number } = {}): { items: Array<Pick<HoldingDiagnosisRun, "id" | "trigger" | "status" | "progress" | "errorMessage" | "createdAt" | "reportId">> } {
    const limit = input.limit ?? 60;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw errors.validation("报告数量范围无效");
    const rows = this.database.all<RunRow & { report_id: string | null }>(
      `SELECT runs.*, reports.id AS report_id
         FROM holding_diagnosis_runs AS runs
         LEFT JOIN holding_diagnosis_reports AS reports ON reports.run_id = runs.id AND reports.user_id = runs.user_id
        WHERE runs.user_id = $userId
        ORDER BY runs.created_at DESC LIMIT $limit`,
      { userId, limit },
    );
    return { items: rows.map((row) => ({ id: row.id, trigger: row.trigger, status: row.status, progress: row.progress, errorMessage: displayErrorMessage(row.error_message), createdAt: row.created_at, reportId: row.report_id })) };
  }

  getReport(userId: string, reportId: string): HoldingDiagnosisReport {
    const report = this.database.get<ReportRow>(
      `SELECT reports.*, runs.error_message, runs.model_snapshot_json
         FROM holding_diagnosis_reports AS reports
         JOIN holding_diagnosis_runs AS runs ON runs.id = reports.run_id AND runs.user_id = reports.user_id
        WHERE reports.id = $id AND reports.user_id = $userId`,
      { id: reportId, userId },
    );
    if (report === undefined) throw errors.notFound("持仓诊断报告不存在");
    const items = this.database.all<ItemRow>(
      "SELECT * FROM holding_diagnosis_items WHERE report_id = $reportId AND user_id = $userId ORDER BY created_at ASC",
      { reportId, userId },
    ).map((row) => toItem(row));
    const sources = this.database.all<SourceRow>(
      "SELECT * FROM holding_diagnosis_sources WHERE report_id = $reportId AND user_id = $userId ORDER BY created_at ASC",
      { reportId, userId },
    ).map((row) => {
      const metadata = sourceMetadata(row.metadata_json, row);
      return {
        id: row.id,
        sourceId: row.source_id,
        sourceName: row.source_name,
        type: row.source_type,
        title: row.title,
        publishedAt: row.published_at,
        fetchedAt: row.fetched_at,
        availability: row.availability,
        url: row.url,
        itemId: row.item_id,
        summary: metadata.summary,
        highlights: metadata.highlights,
      };
    });
    const aiStatus = reportAiStatus(
      report.summary_json,
      report.model_snapshot_json,
      report.error_message,
    );
    return {
      id: report.id,
      runId: report.run_id,
      body: report.body,
      errorMessage: displayErrorMessage(report.error_message),
      marketAsOf: report.market_as_of,
      createdAt: report.created_at,
      aiStatus,
      items,
      sources,
    };
  }

  deleteReports(userId: string, input: { reportIds: string[] }): { deleted: number } {
    const reportIds = [...new Set(input.reportIds)];
    if (reportIds.length === 0 || reportIds.length > 200) throw errors.validation("请选择 1 至 200 份报告");
    return this.database.transaction(() => {
      const placeholders = reportIds.map((_, index) => `$id${index}`).join(", ");
      const parameters: Record<string, string> = { userId };
      reportIds.forEach((id, index) => { parameters[`id${index}`] = id; });
      const rows = this.database.all<{ id: string; run_id: string }>(
        `SELECT id, run_id FROM holding_diagnosis_reports WHERE user_id = $userId AND id IN (${placeholders})`,
        parameters,
      );
      if (rows.length === 0) return { deleted: 0 };
      this.database.run(
        `DELETE FROM holding_diagnosis_reports WHERE user_id = $userId AND id IN (${placeholders})`,
        parameters,
      );
      const runPlaceholders = rows.map((_, index) => `$run${index}`).join(", ");
      const runParameters: Record<string, string> = { userId };
      rows.forEach((row, index) => { runParameters[`run${index}`] = row.run_id; });
      this.database.run(
        `DELETE FROM holding_diagnosis_runs WHERE user_id = $userId AND id IN (${runPlaceholders})`,
        runParameters,
      );
      return { deleted: rows.length };
    });
  }

  private createRun(userId: string, trigger: HoldingDiagnosisTrigger, scheduledTradeDate: string | null): HoldingDiagnosisRun {
    const now = this.clock().toISOString();
    const settings = this.getSettings(userId);
    const id = crypto.randomUUID();
    try {
      this.database.run(
        `INSERT INTO holding_diagnosis_runs (
          id, user_id, trigger, status, progress, scheduled_trade_date, settings_snapshot_json, model_snapshot_json,
          created_at, updated_at
        ) VALUES ($id, $userId, $trigger, 'queued', 0, $scheduledTradeDate, $settings, '{}', $createdAt, $updatedAt)`,
        { id, userId, trigger, scheduledTradeDate, settings: JSON.stringify(settings), createdAt: now, updatedAt: now },
      );
    } catch (error) {
      if (trigger === "scheduled") throw errors.alreadyExists("今日持仓诊断已生成");
      throw error;
    }
    return this.getRun(userId, id);
  }

  private async processRun(userId: string, runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) return;
    this.activeRuns.add(runId);
    const startedAt = this.clock().toISOString();
    this.database.run(
      "UPDATE holding_diagnosis_runs SET status = 'running', progress = 5, started_at = $startedAt, updated_at = $updatedAt WHERE id = $id AND user_id = $userId",
      { id: runId, userId, startedAt, updatedAt: startedAt },
    );
    try {
      const runSettings = this.database.get<{ settings_snapshot_json: string }>(
        "SELECT settings_snapshot_json FROM holding_diagnosis_runs WHERE id = $id AND user_id = $userId",
        { id: runId, userId },
      );
      if (runSettings === undefined) return;
      const settings = normalizeSettings(parseJson(runSettings.settings_snapshot_json));
      const holdings = this.listEligibleHoldings(userId);
      if (holdings.length === 0) throw errors.validation("当前没有可诊断的活动持仓");
      const history = new Map<string, { source: MarketSource | null; bars: PriceBar[]; error: string | null }>();
      const sourceRecords = new Map<string, HoldingDiagnosisSourceRecord[]>();
      for (const holding of holdings) {
        try {
          const result = await this.market.getHistory(userId, holding.instrument_id, "day", false, settings.lookbackTradingDays);
          history.set(holding.instrument_id, { source: result.source, bars: result.bars, error: null });
        } catch (error) {
          history.set(holding.instrument_id, { source: null, bars: [], error: error instanceof Error ? error.message : "行情数据获取失败" });
        }
        const sources = await this.collectSources(holding, settings);
        const marketRecord = marketSourceRecord(
          holding,
          history.get(holding.instrument_id)?.source ?? null,
          history.get(holding.instrument_id)?.bars ?? [],
        );
        if (
          marketRecord !== undefined &&
          (settings.sourceIds.includes("all") || settings.sourceIds.includes("market"))
        ) {
          sources.unshift(marketRecord);
        }
        sourceRecords.set(holding.instrument_id, sources);
      }
      this.database.run("UPDATE holding_diagnosis_runs SET progress = 35, updated_at = $updatedAt WHERE id = $id AND user_id = $userId", { id: runId, userId, updatedAt: this.clock().toISOString() });
      const modelInput: HoldingDiagnosisModelInput = {
        userId,
        reportPreference: settings.reportPreference,
        maxFunctionBatches: settings.maxFunctionBatches,
        items: holdings.map((holding) => {
          const itemHistory = history.get(holding.instrument_id)!;
          return {
            instrumentId: holding.instrument_id,
            name: holding.name,
            code: holding.code,
            quantity: holding.quantity,
            averageCost: holding.quantity === 0 ? null : round(holding.cost / holding.quantity),
            currentPrice: itemHistory.bars.at(-1)?.close ?? null,
            source: itemHistory.source,
            bars: itemHistory.bars,
            externalSources: sourceRecords.get(holding.instrument_id) ?? [],
          };
        }),
        calculateAlgorithms: async (instrumentId, selections) => this.calculateAlgorithms(history.get(instrumentId)?.bars ?? [], selections),
      };
      let generated: HoldingDiagnosisModelOutput | null = null;
      let errorMessage: string | null = null;
      const requestedModel = this.model.getModelSnapshot?.(userId) ?? localFallbackModel();
      let aiStatus: HoldingDiagnosisAiStatus = {
        state: requestedModel.provider === "local" ? "local" : "unavailable",
        model: requestedModel,
        message: requestedModel.provider === "local"
          ? "未配置远程 AI，使用本地行情与指标摘要。"
          : "AI 诊断尚未完成。",
      };
      try {
        generated = await this.model.generate(modelInput);
        const model = generated.model ?? requestedModel;
        aiStatus = {
          state: model.provider === "local" ? "local" : "completed",
          model,
          message: model.provider === "local"
            ? "使用本地行情与指标摘要完成诊断。"
            : "AI 已完成诊断。",
        };
      } catch (error) {
        const fallback = diagnosisFallback(error, requestedModel);
        errorMessage = fallback.message;
        aiStatus = fallback.status;
      }
      const failedSourceCount = [...sourceRecords.values()]
        .flat()
        .filter((source) => source.availability === "failed").length;
      if (failedSourceCount > 0) {
        errorMessage = appendError(
          errorMessage,
          `${failedSourceCount} 个外部资料源不可用，报告仅保留可用本地数据与来源入口`,
        );
      }
      this.database.run(
        "UPDATE holding_diagnosis_runs SET model_snapshot_json = $modelSnapshot, updated_at = $updatedAt WHERE id = $id AND user_id = $userId",
        {
          id: runId,
          userId,
          modelSnapshot: JSON.stringify(
            aiStatus.model,
          ),
          updatedAt: this.clock().toISOString(),
        },
      );
      this.database.run("UPDATE holding_diagnosis_runs SET progress = 75, updated_at = $updatedAt WHERE id = $id AND user_id = $userId", { id: runId, userId, updatedAt: this.clock().toISOString() });
      const output = this.normalizeOutput(generated, modelInput, errorMessage);
      if (output.bodyTooLong) errorMessage = appendError(errorMessage, "AI 报告正文超过 600 字，已使用本地摘要");
      const now = this.clock().toISOString();
      const reportId = crypto.randomUUID();
      this.database.transaction(() => {
        this.database.run(
          `INSERT INTO holding_diagnosis_reports (id, user_id, run_id, body, summary_json, market_as_of, created_at)
           VALUES ($id, $userId, $runId, $body, $summary, $marketAsOf, $createdAt)`,
          {
            id: reportId,
            userId,
            runId,
            body: output.body,
            summary: JSON.stringify({ itemCount: output.items.length, aiStatus }),
            marketAsOf: latestMarketDate(history),
            createdAt: now,
          },
        );
        for (const item of output.items) {
          const id = crypto.randomUUID();
          const holding = holdings.find((candidate) => candidate.instrument_id === item.instrument.id)!;
          this.database.run(
            `INSERT INTO holding_diagnosis_items (
              id, user_id, report_id, instrument_id, data_snapshot_json, chart_snapshot_json, analysis_json,
              recommendation_direction, recommendation_price_json, valid_until, data_quality, created_at
            ) VALUES (
              $id, $userId, $reportId, $instrumentId, $data, $chart, $analysis,
              $direction, $price, $validUntil, $dataQuality, $createdAt
            )`,
            {
              id,
              userId,
              reportId,
              instrumentId: item.instrument.id,
              data: JSON.stringify({ instrument: item.instrument, quantity: holding.quantity, averageCost: item.averageCost, currentPrice: item.currentPrice, profit: item.profit }),
              chart: JSON.stringify(item.chart),
              analysis: JSON.stringify({ analysis: item.analysis, methods: disclosedMethods(item.methods), recommendation: item.recommendation }),
              direction: item.recommendation.direction,
              price: JSON.stringify({ referencePriceLow: item.recommendation.referencePriceLow, referencePriceHigh: item.recommendation.referencePriceHigh, invalidationPrice: item.recommendation.invalidationPrice }),
              validUntil: item.recommendation.validUntil,
              dataQuality: item.dataQuality,
              createdAt: now,
            },
          );
          for (const source of sourceRecords.get(item.instrument.id) ?? []) {
            this.database.run(
              `INSERT INTO holding_diagnosis_sources (
                id, user_id, report_id, item_id, source_id, source_name, source_type, title,
                published_at, fetched_at, availability, url, metadata_json, created_at
              ) VALUES (
                $id, $userId, $reportId, $itemId, $sourceId, $sourceName, $sourceType, $title,
                $publishedAt, $fetchedAt, $availability, $url, $metadata, $createdAt
              )`,
              {
                id: crypto.randomUUID(), userId, reportId, itemId: id, sourceId: source.sourceId, sourceName: source.sourceName,
                sourceType: source.type, title: source.title, publishedAt: source.publishedAt ?? null, fetchedAt: now,
                availability: source.availability ?? (source.transientText ? "available" : "link_only"),
                url: source.url,
                metadata: JSON.stringify(sourceMetadataFromRecord(source)),
                createdAt: now,
              },
            );
          }
        }
      });
      const status: HoldingDiagnosisStatus = errorMessage === null && output.items.every((item) => item.dataQuality === "complete") ? "completed" : "partial";
      this.database.run(
        "UPDATE holding_diagnosis_runs SET status = $status, progress = 100, error_message = $errorMessage, completed_at = $completedAt, updated_at = $updatedAt WHERE id = $id AND user_id = $userId",
        { id: runId, userId, status, errorMessage, completedAt: now, updatedAt: now },
      );
    } catch (error) {
      const now = this.clock().toISOString();
      this.database.run(
        "UPDATE holding_diagnosis_runs SET status = 'failed', error_message = $errorMessage, completed_at = $completedAt, updated_at = $updatedAt WHERE id = $id AND user_id = $userId",
        { id: runId, userId, errorMessage: error instanceof Error ? error.message : "持仓诊断失败", completedAt: now, updatedAt: now },
      );
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private listEligibleHoldings(userId: string): HoldingRow[] {
    const rows = this.database.all<HoldingRow>(
      `SELECT holdings.id AS holding_id, instruments.id AS instrument_id, instruments.code, instruments.exchange,
              instruments.name, instruments.asset_type,
              COALESCE(SUM(CASE WHEN holding_transactions.action = 'buy' THEN holding_transactions.quantity WHEN holding_transactions.action = 'sell' THEN -holding_transactions.quantity ELSE 0 END), 0) AS quantity,
              COALESCE(SUM(CASE WHEN holding_transactions.action = 'buy' THEN holding_transactions.quantity * holding_transactions.price + holding_transactions.fee ELSE 0 END), 0) AS cost
         FROM holdings
         JOIN instruments ON instruments.id = holdings.instrument_id
         LEFT JOIN holding_transactions ON holding_transactions.holding_id = holdings.id AND holding_transactions.user_id = holdings.user_id
        WHERE holdings.user_id = $userId AND holdings.status = 'active'
        GROUP BY holdings.id, instruments.id`,
      { userId },
    );
    return rows.filter((row) => isEligibleInstrument({ id: row.instrument_id, code: row.code, exchange: row.exchange, name: row.name, assetType: row.asset_type, createdAt: "", updatedAt: "" }));
  }

  private async collectSources(holding: HoldingRow, settings: HoldingDiagnosisSettings): Promise<HoldingDiagnosisSourceRecord[]> {
    const selected = new Set(settings.sourceIds);
    const all = selected.has("all");
    const instrument = { id: holding.instrument_id, code: holding.code, exchange: holding.exchange, name: holding.name, assetType: holding.asset_type };
    const collected: HoldingDiagnosisSourceRecord[] = [];
    for (const source of this.sources) {
      if (!all && !selected.has(source.id)) continue;
      try {
        collected.push(...(await source.collect(instrument)).slice(0, settings.maxExternalSourcesPerHolding));
      } catch (error) {
        collected.push({
          sourceId: source.id,
          sourceName: source.label,
          type: "reference",
          title: `${source.label} 暂不可用`,
          url: source.fallbackUrl ?? "",
          availability: "failed",
          summary: `${source.label} 暂不可用，本次未获取可核验的外部摘要。`,
          highlights: ["状态：资料源不可用", "报告仅保留本地行情与其他可用来源"],
          transientText: error instanceof Error ? error.message : "资料源失败",
        });
      }
    }
    return collected.filter((source) => source.url.length > 0);
  }

  private async calculateAlgorithms(bars: PriceBar[], selections: TrendIndicatorSelection[]): Promise<HoldingDiagnosisLocalAlgorithmResult> {
    // Diagnostic requests may compare one indicator across several parameter sets (for example MA 5/10/20).
    // The general strategy editor intentionally rejects duplicate indicator IDs, so validate each requested variant independently here.
    const normalized = selections.flatMap((selection) => normalizeTrendIndicators([selection]));
    const indicators = normalized.flatMap((selection) => this.indicators.calculate(bars, [selection]));
    const methods = normalized.map((selection) => ({
      kind: "local_function" as const,
      name: selection.indicatorId,
      version: "local-trend-v1",
      parameters: selection.parameters,
      dataWindow: bars.length,
      rationale: `${selection.indicatorId} 本地趋势算法计算结果。`,
    }));
    const turningPoints = indicators.flatMap((result, index) =>
      result.turningPoints.map((point) => toTurningPoint(point, methods[index]!)),
    );
    return { methods, indicators, turningPoints };
  }

  private normalizeOutput(generated: HoldingDiagnosisModelOutput | null, input: HoldingDiagnosisModelInput, modelError: string | null): { body: string; bodyTooLong: boolean; items: HoldingDiagnosisItem[] } {
    const bodyTooLong = (generated?.body.length ?? 0) > 600;
    const body = bodyTooLong || generated === null ? localBody(input.items, modelError) : generated.body.trim() || localBody(input.items, modelError);
    const items = input.items.map((inputItem) => {
      const output = generated?.items.find((item) => item.instrumentId === inputItem.instrumentId);
      const latest = inputItem.bars.at(-1);
      const averageCost = inputItem.averageCost;
      const currentPrice = latest?.close ?? null;
      const defaultMethods: HoldingDiagnosisMethod[] = generated === null
        ? [localFallbackMethod(modelError)]
        : [{ kind: "ai_analysis", name: generated.model?.name ?? "AI 持仓诊断", rationale: "AI 基于持仓数据包直接分析。" }];
      const recommendation = normalizeRecommendation(output?.recommendation, currentPrice);
      const chart: HoldingDiagnosisChart = { bars: inputItem.bars, source: inputItem.source ?? "mock", indicators: [], turningPoints: output?.turningPoints ?? [] };
      return {
        id: "",
        instrument: findInstrument(inputItem, this.market),
        quantity: inputItem.quantity,
        averageCost,
        currentPrice,
        profit: currentPrice === null || averageCost === null ? null : round((currentPrice - averageCost) * inputItem.quantity),
        dataQuality: inputItem.bars.length === 0 ? "unavailable" : generated === null ? "partial" : "complete",
        analysis: output?.analysis?.trim() || "行情与持仓数据已整理，需结合后续价格和资料变化继续评估。",
        methods: disclosedMethods(output?.methods?.length ? output.methods : defaultMethods),
        recommendation,
        chart,
      } satisfies HoldingDiagnosisItem;
    });
    return { body: body.slice(0, 600), bodyTooLong, items };
  }
}

function findInstrument(input: HoldingDiagnosisModelInput["items"][number], market: MarketService): HoldingDiagnosisItem["instrument"] {
  const instrument = market.getInstrument(input.instrumentId);
  return { id: instrument.id, code: instrument.code, exchange: instrument.exchange, name: instrument.name, assetType: instrument.assetType };
}

function normalizeSettings(value: unknown): HoldingDiagnosisSettings {
  if (typeof value !== "object" || value === null) return { ...defaultSettings, sourceIds: [...defaultSettings.sourceIds] };
  const next = { ...defaultSettings, ...(value as Partial<HoldingDiagnosisSettings>) };
  try {
    validateSettings(next);
    return { ...next, sourceIds: [...next.sourceIds] };
  } catch {
    return { ...defaultSettings, sourceIds: [...defaultSettings.sourceIds] };
  }
}

function validateSettings(value: HoldingDiagnosisSettings): void {
  const parsed = holdingDiagnosisSettingsSchema.safeParse(value);
  if (!parsed.success) throw errors.validation("持仓诊断配置无效");
  if (value.sourceIds.some((source) => !source.trim())) throw errors.validation("持仓诊断资料源无效");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isEligibleInstrument(instrument: Instrument): boolean {
  return instrument.assetType === "stock" || instrument.assetType === "index" || listedFundExchange(instrument) !== undefined;
}

function marketSourceRecord(
  holding: HoldingRow,
  source: MarketSource | null,
  bars: PriceBar[],
): HoldingDiagnosisSourceRecord | undefined {
  if (source === null || source === "mock") return undefined;
  const symbol = `${holding.exchange === "sh" ? "sh" : "sz"}${holding.code}`;
  const url = source === "tencent"
    ? `https://gu.qq.com/${symbol}`
    : source === "eastmoney"
      ? `https://quote.eastmoney.com/${symbol}.html`
      : "https://akshare.akfamily.xyz/";
  const name = source === "tencent"
    ? "腾讯财经"
    : source === "eastmoney"
      ? "东方财富行情"
      : "AkShare";
  const latest = bars.at(-1);
  const summary = latest === undefined
    ? `本次诊断使用 ${name} 行情来源，但未取得可展示的日线记录。`
    : `本次诊断使用 ${name} 日线行情：截至 ${latest.date} 收盘 ${formatSourcePrice(latest.close)}，共取得 ${bars.length} 个交易日数据。`;
  return {
    sourceId: `market-${source}`,
    sourceName: name,
    type: "market",
    title: `${holding.name} 日线行情（${name}）`,
    url,
    availability: "available",
    summary,
    highlights: latest === undefined
      ? ["数据状态：未取得日线记录"]
      : [
          `最新交易日：${latest.date}`,
          `收盘价：${formatSourcePrice(latest.close)}`,
          `日线样本：${bars.length} 个交易日`,
        ],
  };
}

function disclosedMethods(
  methods: HoldingDiagnosisMethod[],
): HoldingDiagnosisMethod[] {
  const hasAi = methods.some((method) => method.kind === "ai_analysis");
  const hasLocal = methods.some((method) => method.kind === "local_function");
  if (
    !hasAi ||
    !hasLocal ||
    methods.some((method) => method.kind === "hybrid_analysis")
  ) {
    return methods;
  }
  return [
    ...methods,
    {
      kind: "hybrid_analysis",
      name: "AI 与本地算法综合判断",
      rationale: "模型结论结合了受控本地趋势算法的结果；两类方法的参数和证据均单独保留。",
    },
  ];
}

function toTurningPoint(point: TrendTurningPoint, method: HoldingDiagnosisMethod): HoldingDiagnosisTurningPoint {
  return { date: point.date, direction: point.direction, price: point.price, title: point.title, reason: point.reason, methods: [method] };
}

function normalizeRecommendation(value: HoldingDiagnosisRecommendation | undefined, currentPrice: number | null): HoldingDiagnosisRecommendation {
  if (value !== undefined && isDirection(value.direction) && typeof value.timing === "string" && typeof value.uncertainty === "string") {
    return {
      direction: value.direction,
      timing: value.timing.slice(0, 120),
      referencePriceLow: finiteOrNull(value.referencePriceLow),
      referencePriceHigh: finiteOrNull(value.referencePriceHigh),
      invalidationPrice: finiteOrNull(value.invalidationPrice),
      validUntil: validDateOrNull(value.validUntil),
      uncertainty: value.uncertainty.slice(0, 300),
    };
  }
  return { direction: "observe", timing: "等待下一交易日确认", referencePriceLow: currentPrice, referencePriceHigh: currentPrice, invalidationPrice: null, validUntil: null, uncertainty: "缺少完整 AI 或外部资料结果，建议结合后续行情复核。" };
}

function toItem(row: ItemRow): HoldingDiagnosisItem {
  const data = parseJson(row.data_snapshot_json) as { instrument: HoldingDiagnosisItem["instrument"]; quantity: number; averageCost: number | null; currentPrice: number | null; profit: number | null };
  const chart = parseJson(row.chart_snapshot_json) as HoldingDiagnosisChart;
  const analysis = parseJson(row.analysis_json) as { analysis: string; methods: HoldingDiagnosisMethod[]; recommendation: HoldingDiagnosisRecommendation };
  return { id: row.id, instrument: data.instrument, quantity: data.quantity, averageCost: data.averageCost, currentPrice: data.currentPrice, profit: data.profit, dataQuality: row.data_quality, analysis: analysis.analysis, methods: analysis.methods, recommendation: analysis.recommendation, chart };
}

function localBody(items: HoldingDiagnosisModelInput["items"], modelError: string | null): string {
  const names = items.map((item) => item.name).join("、");
  return `已整理 ${items.length} 个持仓（${names}）的本地行情与持仓数据。${modelError ? "AI 或资料源暂不可用，本报告保留本地诊断，需在数据恢复后重新生成。" : "请结合关键价格、趋势变化与资料来源进行独立判断。"}`;
}

function localFallbackModel(): HoldingDiagnosisModelSnapshot {
  return { id: "local-fallback", name: "本地行情与指标摘要", provider: "local" };
}

function localFallbackMethod(error: string | null): HoldingDiagnosisMethod {
  return {
    kind: "local_function",
    name: "本地行情与指标摘要",
    rationale: error === null
      ? "使用本地持仓、日线行情和受控趋势指标生成基础诊断。"
      : "远程 AI 未完成，本报告使用本地持仓、日线行情和受控趋势指标生成基础诊断。",
  };
}

function diagnosisFallback(
  error: unknown,
  model: HoldingDiagnosisModelSnapshot,
): { message: string; status: HoldingDiagnosisAiStatus } {
  const detail = error instanceof Error ? error.message : "";
  const isTimeout = error instanceof DOMException
    ? error.name === "TimeoutError"
    : /timed out|timeout|超时/i.test(detail);
  if (isTimeout) {
    return {
      message: "AI 诊断请求在 90 秒内未完成，已使用本地行情与指标摘要。",
      status: {
        state: "timeout",
        model,
        message: "AI 请求超时，报告已降级为本地行情与指标摘要。",
        timeoutSeconds: 90,
      },
    };
  }
  if (/AI 持仓诊断.*(?:有效 JSON|结果格式|字段)/.test(detail)) {
    return {
      message: "AI 返回的诊断格式不符合要求，已使用本地行情与指标摘要。",
      status: {
        state: "unavailable",
        model,
        message: "AI 返回内容无法解析为诊断报告，报告已降级为本地行情与指标摘要。",
      },
    };
  }
  return {
    message: "AI 诊断暂不可用，已使用本地行情与指标摘要。",
    status: {
      state: model.provider === "local" ? "local" : "unavailable",
      model,
      message: model.provider === "local"
        ? "未配置远程 AI，使用本地行情与指标摘要。"
        : "AI 未完成诊断，报告已降级为本地行情与指标摘要。",
    },
  };
}

function sourceMetadataFromRecord(source: HoldingDiagnosisSourceRecord): { summary: string | null; highlights: string[] } {
  const summary = source.summary?.trim().slice(0, 600) || null;
  const highlights = (source.highlights ?? [])
    .map((item) => item.trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 8);
  return { summary, highlights };
}

function sourceMetadata(
  value: string,
  source?: Pick<SourceRow, "source_name" | "source_type" | "title" | "availability">,
): { summary: string | null; highlights: string[] } {
  const metadata = parseJson(value);
  if (typeof metadata !== "object" || metadata === null) return fallbackSourceMetadata(source);
  const item = metadata as { summary?: unknown; highlights?: unknown };
  const result = {
    summary: typeof item.summary === "string" ? item.summary.slice(0, 600) : null,
    highlights: Array.isArray(item.highlights)
      ? item.highlights.filter((highlight): highlight is string => typeof highlight === "string").map((highlight) => highlight.slice(0, 160)).slice(0, 8)
      : [],
  };
  return result.summary === null && result.highlights.length === 0
    ? fallbackSourceMetadata(source)
    : result;
}

function fallbackSourceMetadata(
  source: Pick<SourceRow, "source_name" | "source_type" | "title" | "availability"> | undefined,
): { summary: string | null; highlights: string[] } {
  if (source === undefined) return { summary: null, highlights: [] };
  if (source.source_type === "market") {
    return {
      summary: `${source.title} 已用于本次报告的行情图表与指标计算。该归档生成时未保存独立来源摘要。`,
      highlights: ["状态：本地行情快照已用于报告", "详情可通过来源链接复核"],
    };
  }
  const availability = source.availability === "failed" ? "资料源当时不可用" : "本次未读取站外正文";
  return {
    summary: `${source.title} 为 ${source.source_name} 的参考入口。${availability}，请在来源页核验具体公告或资讯。`,
    highlights: [
      `来源类型：${source.source_type === "disclosure" ? "披露公告" : source.source_type === "news" ? "财经资讯" : "参考资料"}`,
      source.availability === "failed" ? "状态：资料源不可用" : "状态：仅提供跳转入口，需自行核验",
    ],
  };
}

function reportAiStatus(
  summaryJson: string,
  modelJson: string,
  errorMessage: string | null,
): HoldingDiagnosisAiStatus {
  const summary = parseJson(summaryJson);
  const candidate = typeof summary === "object" && summary !== null
    ? (summary as { aiStatus?: unknown }).aiStatus
    : undefined;
  if (isAiStatus(candidate)) return candidate;
  const model = modelSnapshot(modelJson);
  if (isTimeoutMessage(errorMessage)) {
    return {
      state: "timeout",
      model,
      message: "AI 请求超时，报告已降级为本地行情与指标摘要。",
      timeoutSeconds: 45,
    };
  }
  return {
    state: model.provider === "local" ? "local" : "completed",
    model,
    message: model.provider === "local"
      ? "使用本地行情与指标摘要完成诊断。"
      : "AI 已完成诊断。",
  };
}

function modelSnapshot(value: string): HoldingDiagnosisModelSnapshot {
  const candidate = parseJson(value);
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { id?: unknown }).id === "string" &&
    typeof (candidate as { name?: unknown }).name === "string" &&
    typeof (candidate as { provider?: unknown }).provider === "string"
  ) {
    return candidate as HoldingDiagnosisModelSnapshot;
  }
  return localFallbackModel();
}

function isAiStatus(value: unknown): value is HoldingDiagnosisAiStatus {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<HoldingDiagnosisAiStatus>;
  return (
    (item.state === "completed" || item.state === "local" || item.state === "timeout" || item.state === "unavailable") &&
    typeof item.message === "string" &&
    typeof item.model?.id === "string" &&
    typeof item.model.name === "string" &&
    typeof item.model.provider === "string"
  );
}

function isTimeoutMessage(value: string | null): boolean {
  return value !== null && /The operation timed out|timed out|timeout|超时/i.test(value);
}

function displayErrorMessage(value: string | null): string | null {
  if (isTimeoutMessage(value)) return "AI 诊断请求超时，已使用本地行情与指标摘要。";
  return value;
}

function formatSourcePrice(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
}

function latestMarketDate(history: Map<string, { bars: PriceBar[] }>): string | null {
  return [...history.values()].flatMap((item) => item.bars.map((bar) => bar.date)).sort().at(-1) ?? null;
}

function appendError(previous: string | null, message: string): string {
  return previous === null ? message : `${previous}；${message}`;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validDateOrNull(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function isDirection(value: unknown): value is HoldingRecommendationDirection {
  return value === "add_evaluation" || value === "reduce_evaluation" || value === "hold" || value === "observe" || value === "research_further";
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function shanghaiParts(value: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return { date: `${map.get("year")}-${map.get("month")}-${map.get("day")}`, time: `${map.get("hour")}:${map.get("minute")}` };
}
