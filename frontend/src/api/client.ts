export interface ApiResponse<T> {
  code: number;
  message?: string;
  result: T;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "user";
  status: "active" | "disabled";
}

export interface Session {
  token: string;
  expiresAt: string;
  user: User;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  metadata: unknown;
  createdAt: string;
}

export interface SystemStatus {
  database: "sqlite";
  migrationVersions: number[];
  schedulerMode: "single-instance";
  time: string;
}

export type AssetType = "stock" | "index" | "fund";
export type Exchange = "sh" | "sz" | "bj" | "fund";
export type MarketSource = "tencent" | "eastmoney" | "akshare";

export interface Instrument {
  id: string;
  code: string;
  exchange: Exchange;
  name: string;
  assetType: AssetType;
  createdAt: string;
  updatedAt: string;
}

export interface WatchlistEntry {
  id: string;
  note: string;
  targetPrice: number | null;
  sortOrder: number;
  instrument: Pick<
    Instrument,
    "id" | "code" | "exchange" | "name" | "assetType"
  >;
}

export interface WatchlistWorkspaceEntry extends WatchlistEntry {
  isHeld: boolean;
  latestPrice: number | null;
  quoteDate: string | null;
  previousClose: number | null;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  priceChange: number | null;
  priceChangeRate: number | null;
  amplitudeRate: number | null;
  volumeRatio: number | null;
  turnoverRate: number | null;
  targetPriceDifference: number | null;
}

export interface WatchlistWorkspace {
  items: WatchlistWorkspaceEntry[];
}

export interface HoldingSummary {
  id: string;
  status: "active" | "closed";
  quantity: number;
  cost: number;
  averageCost: number;
  instrument: Pick<
    Instrument,
    "id" | "code" | "exchange" | "name" | "assetType"
  >;
  createdAt: string;
  updatedAt: string;
}

export type HoldingAction = "buy" | "sell" | "interest";

export interface HoldingOperation {
  id: string;
  action: HoldingAction;
  quantity: number;
  price: number;
  fee: number;
  cashImpact: number;
  occurredAt: string;
  note: string;
}

export interface HoldingChartTrace {
  date: string;
  quantity: number;
  netCost: number;
  averageCost: number | null;
  marketValue: number;
  profit: number;
}

export interface HoldingChartData {
  holding: HoldingSummary;
  transactions: HoldingOperation[];
  bars: PriceBar[];
  trace: HoldingChartTrace[];
  macdLines: Record<string, Array<number | null>>;
}

export interface HoldingWorkspaceRecord extends HoldingSummary {
  currentPrice: number | null;
  quoteDate: string | null;
  priceChange: number | null;
  priceChangeRate: number | null;
  marketValue: number | null;
  profit: number | null;
  profitRate: number | null;
}

export interface HoldingWorkspace {
  summary: {
    cashAvailable: number;
    totalCost: number;
    totalMarketValue: number;
    totalAssets: number;
    principal: number;
    profit: number;
    profitRate: number | null;
  };
  active: HoldingWorkspaceRecord[];
  closed: HoldingWorkspaceRecord[];
}

export interface BatmanHoldingWorkspaceRecord extends HoldingWorkspaceRecord {
  costCashFlow: number;
  quantityRatio: number | null;
  costRatio: number | null;
  averagePriceDifference: number | null;
  marketValueRatio: number | null;
  profitRatio: number | null;
  dailyDifference: number | null;
  dailyDifferenceRate: number | null;
}

export interface BatmanHoldingWorkspace {
  summary: HoldingWorkspace["summary"];
  active: BatmanHoldingWorkspaceRecord[];
  closed: BatmanHoldingWorkspaceRecord[];
}

export type FundHistoryStatus = "idle" | "calculating" | "dirty" | "failed";
export type FundDataStatus = "complete" | "partial";

export interface FundHistoryState {
  coveredFrom: string | null;
  coveredTo: string | null;
  dirtyFrom: string | null;
  status: FundHistoryStatus;
  lastError: string | null;
  calculationVersion: number;
  updatedAt: string;
  tradeDayCount: number;
}

export interface FundHistoryPoint {
  tradeDate: string;
  cashAvailable: number;
  principal: number;
  marketValue: number;
  totalAssets: number;
  externalCashFlow: number;
  dailyProfit: number | null;
  dailyReturn: number | null;
  performanceIndex: number;
  cumulativeProfit: number;
  cumulativeProfitRate: number | null;
  instrumentCount: number;
  pricedCount: number;
  carriedPriceCount: number;
  missingPriceCount: number;
  dataStatus: FundDataStatus;
  calculationVersion: number;
  calculatedAt: string;
}

export interface FundHistoryEvent {
  id: string;
  tradeDate: string;
  kind: "adjustment" | "buy" | "sell" | "close" | "dividend";
  label: string;
  amount: number;
  instrumentName: string | null;
}

export interface FundHistoryResult {
  summary: {
    totalAssets: number;
    marketValue: number;
    cashAvailable: number;
    principal: number;
    cumulativeProfit: number;
    cumulativeProfitRate: number | null;
    maxDrawdown: number | null;
  };
  points: FundHistoryPoint[];
  events: FundHistoryEvent[];
  state: FundHistoryState;
}

export interface PriceBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount?: number | null;
  turnoverRate?: number | null;
}

export type CandidateStrategy = "trend_event" | "quality_growth" | "value_repair";
export type CandidateAction = "observe" | "wait_pullback" | "wait_breakout" | "research_further" | "avoid";
export type CandidateRunStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export interface AiCandidateSettings {
  enabled: boolean;
  strategies: CandidateStrategy[];
  topN: 5 | 10 | 20;
  explanationValidityDays: 10;
  maxValidityDays: 20;
  scheduledTime: string;
  retentionDays: number;
}
export interface AiCandidateRun {
  id: string;
  trigger: "manual" | "scheduled";
  tradeDate: string;
  status: CandidateRunStatus;
  progress: number;
  requestedTopN: 5 | 10 | 20;
  strategies: CandidateStrategy[];
  algorithmVersion: string;
  marketRegime: { name: "strong" | "neutral" | "risk"; threshold: number; asOf: string; evidence: string[] };
  dataQuality: Record<string, unknown>;
  modelSnapshot: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}
export interface AiCandidateEvidence {
  id: string;
  label: string;
  value: string | number;
  source: string;
  asOf: string;
}
export interface AiCandidateExplanation {
  summary: string;
  action: CandidateAction;
  thesis: string[];
  counterEvidence: string[];
  referencePriceLow: number | null;
  referencePriceHigh: number | null;
  invalidationPrice: number | null;
  validUntil: string;
  uncertainty: string;
  evidenceIds: string[];
}
export interface AiCandidateItem {
  id: string;
  runId: string;
  strategy: CandidateStrategy;
  rank: number | null;
  score: number;
  percentile: number;
  selected: boolean;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
  scoreSnapshot: Record<string, unknown>;
  evidenceSnapshot: AiCandidateEvidence[];
  explanation: AiCandidateExplanation | null;
  aiStatus: "pending" | "completed" | "local" | "unavailable";
  dataQuality: "complete" | "partial" | "stale" | "unavailable";
  rejectionReason: string | null;
  cycleId: string | null;
  createdAt: string;
}
export interface AiCandidateEvaluation {
  id: string;
  itemId: string;
  cycleId: string | null;
  horizon: 5 | 10 | 20;
  state: "pending" | "matured" | "not_executable" | "indeterminate" | "invalidated" | "insufficient_data";
  targetDate: string | null;
  actualDate: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  grossReturn: number | null;
  netReturn: number | null;
  benchmarkReturn: number | null;
  industryReturn: number | null;
  marketExcessReturn: number | null;
  industryExcessReturn: number | null;
  mfe: number | null;
  mae: number | null;
  maxDrawdown: number | null;
  invalidationResult: boolean | null;
  dataQuality: "complete" | "partial" | "stale" | "unavailable";
  createdAt: string;
  updatedAt: string;
}
export interface AiCandidateRunDetail {
  run: AiCandidateRun;
  items: AiCandidateItem[];
  evaluations: AiCandidateEvaluation[];
  logs: Array<{ id: string; level: string; stage: string; message: string; createdAt: string }>;
}
export interface AiCandidateEvaluationSummary {
  horizons: Record<"5" | "10" | "20", { total: number; matured: number; pending: number; hitRate: number | null; averageNetReturn: number | null; averageExcessReturn: number | null }>;
  byStrategy: Record<CandidateStrategy, { total: number; matured: number; hitRate: number | null; averageNetReturn: number | null }>;
}

export interface DataSourceConfig {
  primary: MarketSource;
  fallback: MarketSource;
}

/** 分时数据来源偏好（仅标明来源，不改变读取/存储/展示行为）。 */
export type IntradayDisplaySource = "snapshot" | "realtime";

export type MarketSnapshotMode = "auto" | "manual";
export type MarketSnapshotScope = "holdings" | "watchlist" | "holdings_watchlist";

export interface MarketSnapshotSettings {
  enabled: boolean;
  mode: MarketSnapshotMode;
  startTime: string;
  endTime: string;
  intervalMinutes: 1 | 3 | 5 | 10 | 15 | 30;
  scope: MarketSnapshotScope;
  retentionDays: 5 | 10 | 15;
}

export interface MarketSnapshotStatus {
  totalCount: number;
  firstCapturedAt: string | null;
  lastCapturedAt: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastCaptureMode: MarketSnapshotMode | null;
  lastTargetCount: number;
  lastCapturedCount: number;
  lastSkippedCount: number;
  lastFailedCount: number;
  lastError: string | null;
}

export type HoldingDiagnosisTrigger = "manual" | "scheduled";
export type HoldingDiagnosisStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
export type HoldingDiagnosisMethodKind =
  | "ai_analysis"
  | "local_function"
  | "hybrid_analysis";
export type HoldingRecommendationDirection =
  | "add_evaluation"
  | "reduce_evaluation"
  | "hold"
  | "observe"
  | "research_further";

export interface HoldingDiagnosisSettings {
  enabled: boolean;
  scheduledTime: string;
  sourceIds: string[];
  reportPreference: string;
  lookbackTradingDays: 20 | 60 | 120;
  maxFunctionBatches: 1 | 2 | 3;
  maxExternalSourcesPerHolding: 1 | 3 | 5;
}

export interface HoldingDiagnosisSourceCatalogItem {
  id: string;
  label: string;
  description: string;
  kind: "market" | "external";
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
  action?: string;
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

export interface HoldingDiagnosisItem {
  id: string;
  instrument: Pick<
    Instrument,
    "id" | "code" | "exchange" | "name" | "assetType"
  >;
  quantity: number;
  averageCost: number | null;
  currentPrice: number | null;
  profit: number | null;
  dataQuality: "complete" | "partial" | "stale" | "unavailable";
  body: string;
  analysis: string;
  errorMessage?: string | null;
  methods: HoldingDiagnosisMethod[];
  recommendation: HoldingDiagnosisRecommendation;
  chart: {
    bars: PriceBar[];
    source: MarketSource | null;
    indicators: TrendIndicatorRunResult[];
    turningPoints: HoldingDiagnosisTurningPoint[];
  };
}

export interface HoldingDiagnosisSource {
  id: string;
  sourceId: string;
  sourceName: string;
  type: "market" | "disclosure" | "news" | "reference";
  title: string;
  publishedAt: string | null;
  fetchedAt: string;
  availability: "available" | "stale" | "failed" | "link_only";
  url: string;
  itemId: string | null;
  summary: string | null;
  highlights: string[];
  externalId: string | null;
  origin: "official" | "licensed" | "aggregated" | "discussion" | null;
  contentHash: string | null;
  retrievedAt: string | null;
  summaryKind: "ai" | "local_excerpt" | "metadata_only";
  sourceInsight: {
    sourceId: string;
    summary: string;
    keyFacts: string[];
    marketImpact: "positive" | "negative" | "mixed" | "unclear";
    confidence: "high" | "medium" | "low";
  } | null;
}

export interface HoldingDiagnosisAiStatus {
  state: "running" | "completed" | "local" | "timeout" | "unavailable";
  model: { id: string; name: string; provider: string };
  message: string;
  timeoutSeconds?: number;
}

export interface HoldingDiagnosisReport {
  id: string;
  runId: string;
  body: string;
  errorMessage: string | null;
  aiStatus: HoldingDiagnosisAiStatus;
  marketAsOf: string | null;
  createdAt: string;
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

export interface MarketSnapshotPoint {
  capturedAt: string;
  tradeDate: string;
  source: MarketSource;
  captureMode: MarketSnapshotMode;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface TradingCalendar {
  year: number;
  tradeDays: string[];
  nonTradingDays: string[];
}

export type AiProvider =
  | "local"
  | "deepseek"
  | "ollama"
  | "openai_compatible"
  | "opencode_go";

export interface AiModelConfig {
  id: string;
  name: string;
  provider: AiProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  enabled: boolean;
  default: boolean;
  apiKeyConfigured?: boolean;
}

export interface AiModelsConfig {
  models: AiModelConfig[];
  systemPrompt: string;
  defaultSystemPrompt: string;
}

export interface AiModelsConfigInput {
  models: AiModelConfig[];
  systemPrompt?: string;
}

export type IndicatorType = "MA" | "MACD" | "RSI" | "BOLL";

export interface IndicatorResult {
  type: IndicatorType;
  lines: Record<string, Array<number | null>>;
}

export type AssistantToolName =
  | "resolve_instrument"
  | "get_account_overview"
  | "get_watchlist"
  | "get_market_snapshot"
  | "get_market_history"
  | "get_technical_indicators"
  | "get_technical_ranking"
  | "get_market_information_links"
  | "get_market_cloud"
  | "calculate_trend"
  | "build_chart";

export interface AssistantToolEvent {
  id: string;
  name: AssistantToolName;
  status: "completed" | "failed";
  summary: string;
}

export interface AssistantChart {
  id: string;
  title: string;
  instrument: Pick<
    Instrument,
    "id" | "code" | "exchange" | "name" | "assetType"
  >;
  source: MarketSource;
  bars: PriceBar[];
  indicators: IndicatorResult[];
  trend?: AssistantTrendChart;
}

export interface AssistantTrendChart {
  indicators: TrendIndicatorRunResult[];
  turningPoints: TrendTurningPoint[];
  assessment: {
    direction: TrendDirection;
    turningPoints: TrendTurningPoint[];
    risk: TrendRiskAssessment;
  };
}

export interface AssistantReplyMetadata {
  provider: AiProvider;
  modelId: string;
  modelName: string;
  tools: AssistantToolEvent[];
  charts: AssistantChart[];
  fallbackReason?: string;
}

export interface AssistantConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  result?: AssistantReplyMetadata;
  createdAt: string;
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  lastMessagePreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantConversationDetail extends AssistantConversationSummary {
  messages: AssistantConversationMessage[];
}

export interface AssistantChatResult extends AssistantReplyMetadata {
  content: string;
  conversation: AssistantConversationSummary;
  userMessage: AssistantConversationMessage;
  assistantMessage: AssistantConversationMessage;
}

export interface Strategy {
  id: string;
  name: string;
  instrumentIds: string[];
  indicators: IndicatorType[];
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisTask {
  id: string;
  strategyId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ScheduledJob {
  id: string;
  name: string;
  kind: "analysis" | "alert-scan";
  strategyId: string | null;
  intervalMinutes: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export type AlertDirection = "above" | "below";
export type AlertRuleKind = "price_threshold" | "target_price" | "trade_plan";
export type AlertRuleSource = "manual" | "system";
export type AlertSeverity = "info" | "warning" | "risk";
export type AlertScopeType = "instrument" | "watchlist" | "holdings" | "custom";
export type AlertEventStatus =
  | "unread"
  | "read"
  | "acknowledged"
  | "snoozed"
  | "resolved";
export type AlertSuggestionSource = "trend" | "watchlist" | "holding" | "system";
export type AlertSuggestionStatus = "pending" | "accepted" | "ignored";
export type AlertSystemMode = "off" | "suggest" | "auto";
export type AlertCondition =
  | { direction: AlertDirection; threshold: number }
  | { direction: AlertDirection; targetPrice: number }
  | {
      action: "buy" | "sell" | "review" | "note";
      note: string;
      scheduledAt: string;
    };

export interface AlertRule {
  id: string;
  name: string;
  kind: AlertRuleKind;
  source: AlertRuleSource;
  severity: AlertSeverity;
  instrumentId: string | null;
  scopeType: AlertScopeType;
  condition: AlertCondition;
  direction: AlertDirection | null;
  threshold: number | null;
  cooldownMinutes: number;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  alertId: string | null;
  ruleId: string | null;
  instrumentId: string | null;
  severity: AlertSeverity;
  status: AlertEventStatus;
  title: string;
  message: string;
  price: number | null;
  snapshot: Record<string, unknown>;
  triggeredAt: string;
  readAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
}

export interface AlertSuggestion {
  id: string;
  source: AlertSuggestionSource;
  instrumentId: string | null;
  title: string;
  message: string;
  severity: AlertSeverity;
  ruleKind: AlertRuleKind;
  condition: AlertCondition;
  cooldownMinutes: number;
  status: AlertSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  ignoredAt: string | null;
}

export interface AlertSettings {
  systemMode: AlertSystemMode;
  defaultCooldownMinutes: number;
  autoScanEnabled: boolean;
  scanIntervalMinutes: number;
  quietHours: { start: string; end: string } | null;
}

export interface Note {
  id: string;
  instrumentId: string | null;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserExport {
  version: 1;
  exportedAt: string;
  data: Record<string, Array<Record<string, string | number | boolean | null>>>;
}

export interface MarketSignal {
  instrumentId: string;
  name: string;
  code: string;
  price: number;
  signals: string[];
  source: MarketSource;
}

export type ThirdPartyTechnicalKind =
  | "new_high"
  | "uptrend"
  | "high_volume"
  | "rise_volume_price"
  | "limit_up_pool";
export type ThirdPartyTableValue = string | number | null;

export interface ThirdPartyTechnicalRow {
  values: Record<string, ThirdPartyTableValue>;
  instrument: Pick<
    Instrument,
    "id" | "code" | "exchange" | "name" | "assetType"
  > | null;
}

export interface ThirdPartyTechnicalTable {
  columns: string[];
  rows: ThirdPartyTechnicalRow[];
  source: "akshare" | "tonghuashun" | "eastmoney" | "local";
  updatedAt: string;
  notice?: string;
}

export interface ThirdPartyInfoLink {
  name: string;
  url: string;
  needCode: boolean;
  openInNewWindow: boolean;
}

export interface ThirdPartyInfoGroup {
  label: string;
  links: ThirdPartyInfoLink[];
}

export interface ThirdPartyMarketCloud {
  title: string;
  url: string;
  openUrl: string;
}

export type TrendTargetScope =
  "holdings" | "watchlist" | "custom" | "all" | "holdings_watchlist";
export type TrendRangePreset = "3m" | "6m" | "1y" | "2y" | "custom";
export type TrendReportWindow = "1d" | "3d" | "7d" | "30d" | "all";
export type TrendDirection = "bullish" | "bearish" | "neutral";
export type TrendRunStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TrendDateRange {
  preset: TrendRangePreset;
  startDate?: string;
  endDate?: string;
}
export interface TrendIndicatorParameter {
  key: string;
  label: string;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
}
export interface TrendIndicatorDetail {
  meaning: string;
  usage: string;
  trend: string;
}
export interface TrendIndicatorDefinition {
  id: string;
  label: string;
  category: string;
  description: string;
  usageHint: string;
  detail: TrendIndicatorDetail;
  parameters: TrendIndicatorParameter[];
  lines: string[];
  chart: "main" | "sub" | "hidden";
}
export interface TrendIndicatorSelection {
  indicatorId: string;
  parameters?: Record<string, number>;
  enabled?: boolean;
  displayOrder?: number;
}
export interface TrendStrategy {
  id: string;
  name: string;
  remarks: string;
  targetScope: TrendTargetScope;
  dataRange: TrendDateRange;
  reportWindow: TrendReportWindow;
  backtestConfig: Record<string, unknown> | null;
  customInstrumentIds: string[];
  indicators: Required<TrendIndicatorSelection>[];
  createdAt: string;
  updatedAt: string;
}
export interface TrendRun {
  id: string;
  strategyId: string;
  status: TrendRunStatus;
  progress: number;
  targetTotal: number;
  targetCompleted: number;
  errorMessage: string | null;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  overallDirection: TrendDirection | null;
}
export interface TrendStrategyTarget {
  instrument: Pick<
    Instrument,
    "id" | "code" | "exchange" | "name" | "assetType"
  >;
  currentPrice: number | null;
}
export interface TrendStrategyTargets {
  targetScope: TrendTargetScope;
  items: TrendStrategyTarget[];
}
export interface TrendSignal {
  date: string;
  direction: TrendDirection;
  strength: number;
  reason: string;
}
export interface TrendTurningPoint {
  date: string;
  direction: Exclude<TrendDirection, "neutral">;
  level: "info" | "warning" | "risk";
  title: string;
  reason: string;
  price: number | null;
  indicatorId: string;
}
export interface TrendRiskReminder {
  direction: "above" | "below";
  threshold: number;
  cooldownMinutes: number;
}
export interface TrendRiskAssessment {
  level: "high" | "medium" | "low";
  evidence: string[];
  suggestedAction: string;
  reminder: TrendRiskReminder | null;
}
export interface TrendIndicatorRunResult {
  indicatorId: string;
  lines: Record<string, Array<number | null>>;
  signals: TrendSignal[];
  turningPoints: TrendTurningPoint[];
}
export interface TrendRunReport {
  id: string;
  instrumentId: string;
  aiInterpretation: Pick<TrendRunReportInterpretation, "provider" | "createdAt"> | null;
  result: {
    instrument: Pick<
      Instrument,
      "id" | "code" | "exchange" | "name" | "assetType"
    >;
    source: MarketSource | null;
    bars: PriceBar[];
    indicators: TrendIndicatorRunResult[];
    direction: TrendDirection;
    turningPoints: TrendTurningPoint[];
    risk: TrendRiskAssessment;
    error: string | null;
  };
  createdAt: string;
}

export interface TrendRunReportInterpretation {
  provider: AiProvider;
  content: string;
  createdAt: string;
}
export interface TrendRunLog {
  id: string;
  level: "info" | "error";
  message: string;
  createdAt: string;
}
export interface TrendRunSummary {
  total: number;
  direction: Record<TrendDirection, number>;
  risk: Record<TrendRiskAssessment["level"], number>;
  turningPointCount: number;
  riskItems: Array<{
    reportId: string;
    instrument: TrendRunReport["result"]["instrument"];
    risk: TrendRiskAssessment;
  }>;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function post<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || payload.code !== 0) {
    throw new ApiError(
      payload.message ?? "请求失败",
      payload.code,
      response.status,
    );
  }
  return payload.result;
}

export const api = {
  login: (email: string, password: string) =>
    post<Session>("/auth/login", { email, password }),
  register: (email: string, password: string, displayName: string) =>
    post<Session>("/auth/register", { email, password, displayName }),
  logout: (token: string) =>
    post<{ loggedOut: true }>("/auth/logout", {}, token),
  me: (token: string) => post<User>("/account/me", {}, token),
  updateProfile: (token: string, displayName: string) =>
    post<User>("/account/profile/update", { displayName }, token),
  changePassword: (
    token: string,
    currentPassword: string,
    newPassword: string,
  ) =>
    post<{ changed: true }>(
      "/account/password/change",
      { currentPassword, newPassword },
      token,
    ),
  listUsers: (token: string) =>
    post<{ items: User[] }>("/admin/users/list", {}, token),
  updateUserStatus: (token: string, userId: string, status: User["status"]) =>
    post<{ updated: true }>("/admin/users/status", { userId, status }, token),
  listAuditLogs: (token: string, limit = 50) =>
    post<{ items: AuditLog[] }>("/admin/audit-logs/list", { limit }, token),
  systemStatus: (token: string) =>
    post<SystemStatus>("/admin/system/status", {}, token),
  upsertInstrument: (
    token: string,
    input: {
      code: string;
      exchange: Exchange;
      name: string;
      assetType: AssetType;
    },
  ) => post<Instrument>("/market/instruments/upsert", input, token),
  searchInstruments: (token: string, query: string, assetType?: AssetType) =>
    post<{ items: Instrument[] }>(
      "/market/instruments/search",
      { query, ...(assetType === undefined ? {} : { assetType }) },
      token,
    ),
  getDataSourceConfig: (token: string) =>
    post<DataSourceConfig>("/settings/data-sources/get", {}, token),
  updateDataSourceConfig: (token: string, config: DataSourceConfig) =>
    post<DataSourceConfig>("/settings/data-sources/update", config, token),
  getIntradaySource: (token: string) =>
    post<{ source: IntradayDisplaySource }>("/settings/intraday-source/get", {}, token),
  updateIntradaySource: (token: string, source: IntradayDisplaySource) =>
    post<{ source: IntradayDisplaySource }>("/settings/intraday-source/update", { source }, token),
  getTradingCalendar: (token: string, year: number) =>
    post<TradingCalendar>("/settings/trading-calendar/get", { year }, token),
  updateTradingCalendar: (
    token: string,
    input: { year: number; tradeDays: string[] },
  ) => post<TradingCalendar>("/settings/trading-calendar/update", input, token),
  refreshReferencedMarketData: (token: string) =>
    post<{ requested: number; refreshed: number; failed: number }>(
      "/settings/market/refresh",
      {},
      token,
    ),
  getMarketSnapshotSettings: (token: string) =>
    post<MarketSnapshotSettings>("/settings/market-snapshots/get", {}, token),
  updateMarketSnapshotSettings: (
    token: string,
    input: MarketSnapshotSettings,
  ) =>
    post<MarketSnapshotSettings>(
      "/settings/market-snapshots/update",
      input,
      token,
    ),
  marketSnapshotStatus: (token: string) =>
    post<MarketSnapshotStatus>("/settings/market-snapshots/status", {}, token),
  deleteMarketSnapshots: (token: string) =>
    post<{ deleted: number }>("/settings/market-snapshots/delete", {}, token),
  getHoldingDiagnosisSettings: (token: string) =>
    post<HoldingDiagnosisSettings>(
      "/analysis/holding-diagnosis/settings/get",
      {},
      token,
    ),
  updateHoldingDiagnosisSettings: (
    token: string,
    input: Partial<HoldingDiagnosisSettings>,
  ) =>
    post<HoldingDiagnosisSettings>(
      "/analysis/holding-diagnosis/settings/update",
      input,
      token,
    ),
  holdingDiagnosisSourceCatalog: (token: string) =>
    post<{ items: HoldingDiagnosisSourceCatalogItem[] }>(
      "/analysis/holding-diagnosis/sources/catalog",
      {},
      token,
    ),
  startHoldingDiagnosis: (token: string) =>
    post<HoldingDiagnosisRun>("/analysis/holding-diagnosis/start", {}, token),
  listHoldingDiagnosisRuns: (token: string, limit = 60) =>
    post<{ items: Array<Pick<HoldingDiagnosisRun, "id" | "trigger" | "status" | "progress" | "errorMessage" | "createdAt" | "reportId">> }>(
      "/analysis/holding-diagnosis/runs/list",
      { limit },
      token,
    ),
  getHoldingDiagnosisRun: (token: string, id: string) =>
    post<HoldingDiagnosisRun>(
      "/analysis/holding-diagnosis/runs/get",
      { id },
      token,
    ),
  getHoldingDiagnosisReport: (token: string, id: string) =>
    post<HoldingDiagnosisReport>(
      "/analysis/holding-diagnosis/reports/get",
      { id },
      token,
    ),
  deleteHoldingDiagnosisReport: (token: string, id: string) =>
    post<{ deleted: number }>(
      "/analysis/holding-diagnosis/reports/delete",
      { id },
      token,
    ),
  deleteHoldingDiagnosisReports: (token: string, reportIds: string[]) =>
    post<{ deleted: number }>(
      "/analysis/holding-diagnosis/reports/delete-batch",
      { reportIds },
      token,
    ),
  deleteAllHoldingDiagnosisReports: (token: string) =>
    post<{ deleted: number }>(
      "/analysis/holding-diagnosis/reports/delete-all",
      {},
      token,
    ),
  getAiCandidateSettings: (token: string) =>
    post<AiCandidateSettings>("/analysis/ai-candidates/settings/get", {}, token),
  updateAiCandidateSettings: (
    token: string,
    input: Partial<AiCandidateSettings>,
  ) =>
    post<AiCandidateSettings>("/analysis/ai-candidates/settings/update", input, token),
  createAiCandidateRun: (
    token: string,
    input: { tradeDate?: string; topN?: 5 | 10 | 20; strategies?: CandidateStrategy[] },
  ) =>
    post<AiCandidateRun>("/analysis/ai-candidates/runs/create", input, token),
  listAiCandidateRuns: (token: string, limit = 60) =>
    post<{ items: AiCandidateRun[] }>("/analysis/ai-candidates/runs/list", { limit }, token),
  getAiCandidateRunDetail: (token: string, id: string) =>
    post<AiCandidateRunDetail>("/analysis/ai-candidates/runs/detail", { id }, token),
  cancelAiCandidateRun: (token: string, id: string) =>
    post<AiCandidateRun>("/analysis/ai-candidates/runs/cancel", { id }, token),
  deleteAiCandidateDate: (token: string, tradeDate: string) =>
    post<{ deleted: true }>("/analysis/ai-candidates/runs/delete", { tradeDate }, token),
  latestAiCandidates: (token: string, tradeDate?: string) =>
    post<{ run: AiCandidateRun | null; items: AiCandidateItem[] }>(
      "/analysis/ai-candidates/latest",
      tradeDate === undefined ? {} : { tradeDate },
      token,
    ),
  aiCandidateEvaluationSummary: (token: string) =>
    post<AiCandidateEvaluationSummary>("/analysis/ai-candidates/evaluations/summary", {}, token),
  marketSnapshotSeries: (
    token: string,
    instrumentId: string,
    startAt: string,
    endAt: string,
  ) =>
    post<{ items: MarketSnapshotPoint[] }>(
      "/market/snapshots/series",
      { instrumentId, startAt, endAt },
      token,
    ),
  marketMinute: (
    token: string,
    instrumentId: string,
    date?: string,
  ) =>
    post<{
      source: MarketSource;
      date: string;
      points: Array<{ time: string; price: number; volume: number; cumulativeAmount: number }>;
      benchmark: {
        code: string;
        name: string;
        points: Array<{ time: string; price: number; volume: number; cumulativeAmount: number }>;
      } | null;
    }>("/market/minute", { instrumentId, date }, token),
  history: (
    token: string,
    instrumentId: string,
    refresh = false,
    limit = 180,
  ) =>
    post<{ source: MarketSource; bars: PriceBar[] }>(
      "/market/history",
      { instrumentId, timeframe: "day", refresh, limit },
      token,
    ),
  calculateIndicators: (
    token: string,
    instrumentId: string,
    indicators: IndicatorType[],
    refresh = false,
    limit = 180,
  ) =>
    post<{
      source: MarketSource;
      bars: PriceBar[];
      results: IndicatorResult[];
    }>(
      "/analysis/indicators/calculate",
      { instrumentId, indicators, refresh, limit },
      token,
    ),
  listWatchlist: (token: string) =>
    post<{ items: WatchlistEntry[] }>("/assets/watchlist/list", {}, token),
  createWatchlist: (
    token: string,
    input: { instrumentId: string; note: string; targetPrice?: number },
  ) => post<WatchlistEntry>("/assets/watchlist/create", input, token),
  watchlistWorkspace: (token: string, refresh = false) =>
    post<WatchlistWorkspace>("/assets/watchlist/workspace", { refresh }, token),
  updateWatchlist: (
    token: string,
    input: { id: string; note?: string; targetPrice?: number | null },
  ) => post<WatchlistEntry>("/assets/watchlist/update", input, token),
  deleteWatchlist: (token: string, id: string) =>
    post<{ deleted: true }>("/assets/watchlist/delete", { id }, token),
  cashSummary: (token: string) =>
    post<{ available: number }>("/assets/cash/summary", {}, token),
  adjustCash: (token: string, amount: number, note: string) =>
    post<{ available: number }>("/assets/cash/adjust", { amount, note }, token),
  fundHistory: (token: string, startDate: string, endDate: string) =>
    post<FundHistoryResult>(
      "/assets/funds/history",
      { startDate, endDate },
      token,
    ),
  fundHistoryStatus: (token: string) =>
    post<FundHistoryState>("/assets/funds/history/status", {}, token),
  recalculateFundHistory: (token: string) =>
    post<FundHistoryResult>("/assets/funds/history/recalculate", {}, token),
  listHoldings: (token: string) =>
    post<{ items: HoldingSummary[]; cashAvailable: number }>(
      "/assets/holdings/list",
      {},
      token,
    ),
  holdingWorkspace: (token: string, refresh = false) =>
    post<HoldingWorkspace>("/assets/holdings/workspace", { refresh }, token),
  batmanHoldingWorkspace: (token: string, refresh = false) =>
    post<BatmanHoldingWorkspace>(
      "/assets/holdings/batman-workspace",
      { refresh },
      token,
    ),
  createHolding: (
    token: string,
    input: {
      instrumentId: string;
      quantity: number;
      price: number;
      fee: number;
      occurredAt: string;
      note?: string;
    },
  ) => post<HoldingSummary>("/assets/holdings/create", input, token),
  holdingDetail: (token: string, id: string) =>
    post<{ holding: HoldingSummary; transactions: HoldingOperation[] }>(
      "/assets/holdings/detail",
      { id },
      token,
    ),
  holdingChart: (token: string, id: string, refresh = false) =>
    post<HoldingChartData>(
      "/assets/holdings/detail/chart",
      { id, refresh },
      token,
    ),
  deleteHolding: (token: string, id: string) =>
    post<{ deleted: true }>("/assets/holdings/delete", { id }, token),
  addHoldingTransaction: (
    token: string,
    input: {
      holdingId: string;
      action: HoldingAction;
      quantity: number;
      price: number;
      fee: number;
      occurredAt: string;
      note?: string;
    },
  ) => post<{ id: string }>("/assets/holdings/transaction", input, token),
  deleteHoldingTransaction: (
    token: string,
    holdingId: string,
    transactionId: string,
  ) =>
    post<{ deleted: true }>(
      "/assets/holdings/transaction/delete",
      { holdingId, transactionId },
      token,
    ),
  createStrategy: (
    token: string,
    input: {
      name: string;
      instrumentIds: string[];
      indicators: IndicatorType[];
    },
  ) => post<Strategy>("/analysis/strategies/create", input, token),
  listStrategies: (token: string) =>
    post<{ items: Strategy[] }>("/analysis/strategies/list", {}, token),
  startAnalysis: (token: string, strategyId: string) =>
    post<AnalysisTask>("/analysis/tasks/start", { strategyId }, token),
  listAnalysisTasks: (token: string) =>
    post<{ items: AnalysisTask[] }>("/analysis/tasks/list", {}, token),
  retryAnalysis: (token: string, taskId: string) =>
    post<AnalysisTask>("/analysis/tasks/retry", { taskId }, token),
  listTaskLogs: (token: string, taskId: string) =>
    post<{
      items: Array<{
        id: string;
        level: "info" | "error";
        message: string;
        createdAt: string;
      }>;
    }>("/analysis/tasks/logs/list", { taskId }, token),
  listReports: (token: string, taskId: string) =>
    post<{
      items: Array<{
        id: string;
        instrumentId: string;
        result: { source: string; results: IndicatorResult[] };
        createdAt: string;
      }>;
    }>("/analysis/reports/list", { taskId }, token),
  trendIndicatorCatalog: (token: string) =>
    post<{ items: TrendIndicatorDefinition[] }>(
      "/analysis/trend/indicators/catalog",
      {},
      token,
    ),
  createTrendStrategy: (
    token: string,
    input: Omit<TrendStrategy, "id" | "createdAt" | "updatedAt">,
  ) => post<TrendStrategy>("/analysis/trend/strategies/create", input, token),
  updateTrendStrategy: (token: string, input: TrendStrategy) =>
    post<TrendStrategy>("/analysis/trend/strategies/update", input, token),
  deleteTrendStrategy: (token: string, id: string) =>
    post<{ deleted: true }>("/analysis/trend/strategies/delete", { id }, token),
  getTrendStrategy: (token: string, id: string) =>
    post<TrendStrategy>("/analysis/trend/strategies/get", { id }, token),
  listTrendStrategies: (token: string) =>
    post<{ items: TrendStrategy[] }>(
      "/analysis/trend/strategies/list",
      {},
      token,
    ),
  updateTrendStrategyTargets: (
    token: string,
    strategyId: string,
    instrumentIds: string[],
  ) =>
    post<TrendStrategy>(
      "/analysis/trend/strategies/targets/update",
      { strategyId, instrumentIds },
      token,
    ),
  listTrendStrategyTargets: (token: string, strategyId: string) =>
    post<TrendStrategyTargets>(
      "/analysis/trend/strategies/targets/list",
      { strategyId },
      token,
    ),
  estimateTrendRun: (token: string, strategyId: string) =>
    post<{
      targetTotal: number;
      confirmationToken: string | null;
      expiresAt: string | null;
    }>("/analysis/trend/runs/estimate", { strategyId }, token),
  startTrendRun: (
    token: string,
    strategyId: string,
    confirmationToken?: string,
  ) =>
    post<TrendRun>(
      "/analysis/trend/runs/start",
      { strategyId, confirmationToken },
      token,
    ),
  cancelTrendRun: (token: string, runId: string) =>
    post<TrendRun>("/analysis/trend/runs/cancel", { runId }, token),
  deleteTrendRun: (token: string, runId: string) =>
    post<{ deleted: true }>("/analysis/trend/runs/delete", { runId }, token),
  getTrendRun: (token: string, runId: string) =>
    post<TrendRun>("/analysis/trend/runs/get", { runId }, token),
  listTrendRuns: (token: string, strategyId?: string) =>
    post<{ items: TrendRun[] }>(
      "/analysis/trend/runs/list",
      { strategyId },
      token,
    ),
  listTrendReports: (token: string, runId: string) =>
    post<{ items: TrendRunReport[] }>(
      "/analysis/trend/reports/list",
      { runId },
      token,
    ),
  trendRunSummary: (token: string, runId: string) =>
    post<TrendRunSummary>("/analysis/trend/runs/summary", { runId }, token),
  interpretTrendReport: (token: string, runId: string, reportId: string) =>
    post<TrendRunReportInterpretation & { cached: boolean }>(
      "/analysis/trend/reports/interpret",
      { runId, reportId },
      token,
    ),
  listTrendLogs: (token: string, runId: string) =>
    post<{ items: TrendRunLog[] }>(
      "/analysis/trend/logs/list",
      { runId },
      token,
    ),
  createSchedule: (
    token: string,
    input: {
      name: string;
      kind: "analysis" | "alert-scan";
      intervalMinutes: number;
      strategyId: string | null;
    },
  ) => post<ScheduledJob>("/automation/schedules/create", input, token),
  listSchedules: (token: string) =>
    post<{ items: ScheduledJob[] }>("/automation/schedules/list", {}, token),
  createAlert: (
    token: string,
    input: {
      instrumentId: string;
      direction: AlertDirection;
      threshold: number;
      cooldownMinutes: number;
    },
  ) => post<AlertRule>("/automation/alerts/create", input, token),
  listAlerts: (token: string) =>
    post<{ items: AlertRule[] }>("/automation/alerts/list", {}, token),
  createAlertRule: (
    token: string,
    input: {
      name: string;
      kind: AlertRuleKind;
      instrumentId?: string | null;
      condition: AlertCondition;
      severity?: AlertSeverity;
      cooldownMinutes?: number;
      enabled?: boolean;
      scopeType?: AlertScopeType;
    },
  ) => post<AlertRule>("/automation/alerts/rules/create", input, token),
  listAlertRules: (token: string) =>
    post<{ items: AlertRule[] }>("/automation/alerts/rules/list", {}, token),
  deleteAlertRule: (token: string, id: string) =>
    post<{ deleted: true }>("/automation/alerts/rules/delete", { id }, token),
  evaluateAlerts: (token: string) =>
    post<{ triggered: number }>("/automation/alerts/evaluate", {}, token),
  listAlertEvents: (token: string, status?: AlertEventStatus) =>
    post<{ items: AlertEvent[] }>(
      "/automation/alerts/events/list",
      { status },
      token,
    ),
  updateAlertEventStatus: (
    token: string,
    input: {
      id: string;
      status: AlertEventStatus;
      snoozedUntil?: string | null;
    },
  ) => post<AlertEvent>("/automation/alerts/events/update-status", input, token),
  createAlertSuggestion: (
    token: string,
    input: {
      source: AlertSuggestionSource;
      instrumentId?: string | null;
      title: string;
      message: string;
      severity: AlertSeverity;
      ruleKind: AlertRuleKind;
      condition: AlertCondition;
      cooldownMinutes?: number;
    },
  ) =>
    post<AlertSuggestion>(
      "/automation/alerts/suggestions/create",
      input,
      token,
    ),
  listAlertSuggestions: (token: string, status?: AlertSuggestionStatus) =>
    post<{ items: AlertSuggestion[] }>(
      "/automation/alerts/suggestions/list",
      { status },
      token,
    ),
  acceptAlertSuggestion: (token: string, id: string) =>
    post<{ suggestion: AlertSuggestion; rule: AlertRule }>(
      "/automation/alerts/suggestions/accept",
      { id },
      token,
    ),
  getAlertSettings: (token: string) =>
    post<AlertSettings>("/automation/alerts/settings/get", {}, token),
  updateAlertSettings: (token: string, input: Partial<AlertSettings>) =>
    post<AlertSettings>("/automation/alerts/settings/update", input, token),
  createNote: (
    token: string,
    input: {
      title: string;
      content: string;
      tags: string[];
      instrumentId: string | null;
    },
  ) => post<Note>("/notes/create", input, token),
  listNotes: (token: string) =>
    post<{ items: Note[] }>("/notes/list", {}, token),
  updateNote: (
    token: string,
    input: {
      id: string;
      title: string;
      content: string;
      tags: string[];
      instrumentId: string | null;
    },
  ) => post<Note>("/notes/update", input, token),
  deleteNote: (token: string, id: string) =>
    post<{ deleted: true }>("/notes/delete", { id }, token),
  exportData: (token: string) =>
    post<UserExport>("/settings/data/export", {}, token),
  importData: (token: string, data: unknown) =>
    post<{ imported: true }>("/settings/data/import", { data }, token),
  getAiConfig: (token: string) =>
    post<AiModelsConfig>("/settings/ai/get", {}, token),
  updateAiConfig: (token: string, input: AiModelsConfigInput) =>
    post<AiModelsConfig>("/settings/ai/update", input, token),
  listOpenCodeGoModels: (token: string) =>
    post<{ models: Array<{ id: string }> }>(
      "/settings/ai/opencode-go/models",
      {},
      token,
    ),
  createAssistantConversation: (token: string) =>
    post<AssistantConversationDetail>(
      "/assistant/conversations/create",
      {},
      token,
    ),
  listAssistantConversations: (token: string) =>
    post<{ items: AssistantConversationSummary[] }>(
      "/assistant/conversations/list",
      {},
      token,
    ),
  getAssistantConversation: (token: string, id: string) =>
    post<AssistantConversationDetail>(
      "/assistant/conversations/get",
      { id },
      token,
    ),
  deleteAssistantConversation: (token: string, id: string) =>
    post<{ deleted: true }>("/assistant/conversations/delete", { id }, token),
  chat: (
    token: string,
    message: string,
    options: {
      modelId?: string;
      autoChart?: boolean;
      conversationId?: string;
    } = {},
  ) =>
    post<AssistantChatResult>(
      "/assistant/chat",
      { message, ...options },
      token,
    ),
  clearMarketCache: (token: string) =>
    post<{ deletedBars: number }>("/admin/market/cache/clear", {}, token),
  marketOverview: (token: string) =>
    post<{
      instrumentCount: number;
      cachedBarCount: number;
      latestCacheAt: string | null;
    }>("/market/overview", {}, token),
  marketSignals: (token: string) =>
    post<{ items: MarketSignal[] }>("/market/signals", {}, token),
  informationLinks: (token: string) =>
    post<{
      groups: Array<{
        label: string;
        links: Array<{ name: string; url: string }>;
      }>;
    }>("/market/info-links", {}, token),
  thirdPartyTechnical: (
    token: string,
    input: {
      kind: ThirdPartyTechnicalKind;
      category?: number;
      days?: number;
      date?: string;
    },
  ) =>
    post<ThirdPartyTechnicalTable>(
      "/third-party/technical/query",
      input,
      token,
    ),
  thirdPartyInfoLinks: (token: string) =>
    post<{ groups: ThirdPartyInfoGroup[] }>(
      "/third-party/info-links",
      {},
      token,
    ),
  thirdPartyMarketCloud: (token: string) =>
    post<ThirdPartyMarketCloud>("/third-party/market-cloud", {}, token),
  streamTask: (token: string, taskId: string) =>
    new EventSource(
      `${apiBaseUrl}/stream/tasks/${encodeURIComponent(taskId)}?token=${encodeURIComponent(token)}`,
    ),
  streamTrendRun: (token: string, runId: string) =>
    new EventSource(
      `${apiBaseUrl}/analysis/trend/runs/${encodeURIComponent(runId)}/events?token=${encodeURIComponent(token)}`,
    ),
  streamWatchlist: (token: string) =>
    new EventSource(
      `${apiBaseUrl}/stream/watchlist?token=${encodeURIComponent(token)}`,
    ),
};
