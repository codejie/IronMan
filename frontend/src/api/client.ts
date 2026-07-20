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
    public readonly status: number
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
export type MarketSource = "mock" | "tencent" | "eastmoney";

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
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
}

export interface HoldingSummary {
  id: string;
  status: "active" | "closed";
  quantity: number;
  averageCost: number;
  instrument: Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;
  updatedAt: string;
}

export interface PriceBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface DataSourceConfig {
  primary: MarketSource;
  fallback: MarketSource;
}

export type IndicatorType = "MA" | "MACD" | "RSI" | "BOLL";

export interface IndicatorResult {
  type: IndicatorType;
  lines: Record<string, Array<number | null>>;
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

export interface AlertRule {
  id: string;
  instrumentId: string;
  direction: "above" | "below";
  threshold: number;
  cooldownMinutes: number;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  alertId: string;
  price: number;
  message: string;
  createdAt: string;
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

export interface AiConfig {
  provider: "local" | "openai";
  baseUrl?: string;
  model?: string;
  apiKeyConfigured: boolean;
}

export interface MarketSignal {
  instrumentId: string;
  name: string;
  code: string;
  price: number;
  signals: string[];
  source: MarketSource;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` })
    },
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || payload.code !== 0) {
    throw new ApiError(payload.message ?? "请求失败", payload.code, response.status);
  }
  return payload.result;
}

export const api = {
  login: (email: string, password: string) => post<Session>("/auth/login", { email, password }),
  register: (email: string, password: string, displayName: string) =>
    post<Session>("/auth/register", { email, password, displayName }),
  logout: (token: string) => post<{ loggedOut: true }>("/auth/logout", {}, token),
  me: (token: string) => post<User>("/account/me", {}, token),
  updateProfile: (token: string, displayName: string) => post<User>("/account/profile/update", { displayName }, token),
  changePassword: (token: string, currentPassword: string, newPassword: string) =>
    post<{ changed: true }>("/account/password/change", { currentPassword, newPassword }, token),
  listUsers: (token: string) => post<{ items: User[] }>("/admin/users/list", {}, token),
  updateUserStatus: (token: string, userId: string, status: User["status"]) =>
    post<{ updated: true }>("/admin/users/status", { userId, status }, token),
  listAuditLogs: (token: string, limit = 50) => post<{ items: AuditLog[] }>("/admin/audit-logs/list", { limit }, token),
  systemStatus: (token: string) => post<SystemStatus>("/admin/system/status", {}, token),
  upsertInstrument: (token: string, input: { code: string; exchange: Exchange; name: string; assetType: AssetType }) =>
    post<Instrument>("/market/instruments/upsert", input, token),
  searchInstruments: (token: string, query: string) => post<{ items: Instrument[] }>("/market/instruments/search", { query }, token),
  getDataSourceConfig: (token: string) => post<DataSourceConfig>("/settings/data-sources/get", {}, token),
  updateDataSourceConfig: (token: string, config: DataSourceConfig) => post<DataSourceConfig>("/settings/data-sources/update", config, token),
  getTradingCalendar: (token: string) => post<{ nonTradingDays: string[] }>("/settings/trading-calendar/get", {}, token),
  updateTradingCalendar: (token: string, nonTradingDays: string[]) => post<{ nonTradingDays: string[] }>("/settings/trading-calendar/update", { nonTradingDays }, token),
  history: (token: string, instrumentId: string, refresh = false) =>
    post<{ source: MarketSource; bars: PriceBar[] }>("/market/history", { instrumentId, timeframe: "day", refresh }, token),
  calculateIndicators: (token: string, instrumentId: string, indicators: IndicatorType[], refresh = false) =>
    post<{ source: MarketSource; bars: PriceBar[]; results: IndicatorResult[] }>("/analysis/indicators/calculate", { instrumentId, indicators, refresh }, token),
  listWatchlist: (token: string) => post<{ items: WatchlistEntry[] }>("/assets/watchlist/list", {}, token),
  createWatchlist: (token: string, input: { instrumentId: string; note: string; targetPrice?: number }) =>
    post<WatchlistEntry>("/assets/watchlist/create", input, token),
  deleteWatchlist: (token: string, id: string) => post<{ deleted: true }>("/assets/watchlist/delete", { id }, token),
  cashSummary: (token: string) => post<{ available: number }>("/assets/cash/summary", {}, token),
  adjustCash: (token: string, amount: number, note: string) => post<{ available: number }>("/assets/cash/adjust", { amount, note }, token),
  listHoldings: (token: string) => post<{ items: HoldingSummary[]; cashAvailable: number }>("/assets/holdings/list", {}, token),
  createHolding: (token: string, input: { instrumentId: string; quantity: number; price: number; fee: number; occurredAt: string; note?: string }) =>
    post<HoldingSummary>("/assets/holdings/create", input, token),
  addHoldingTransaction: (token: string, input: { holdingId: string; action: "buy" | "sell" | "dividend"; quantity: number; price: number; fee: number; occurredAt: string; note?: string }) =>
    post<{ id: string }>("/assets/holdings/transaction", input, token),
  createStrategy: (token: string, input: { name: string; instrumentIds: string[]; indicators: IndicatorType[] }) => post<Strategy>("/analysis/strategies/create", input, token),
  listStrategies: (token: string) => post<{ items: Strategy[] }>("/analysis/strategies/list", {}, token),
  startAnalysis: (token: string, strategyId: string) => post<AnalysisTask>("/analysis/tasks/start", { strategyId }, token),
  listAnalysisTasks: (token: string) => post<{ items: AnalysisTask[] }>("/analysis/tasks/list", {}, token),
  retryAnalysis: (token: string, taskId: string) => post<AnalysisTask>("/analysis/tasks/retry", { taskId }, token),
  listTaskLogs: (token: string, taskId: string) => post<{ items: Array<{ id: string; level: "info" | "error"; message: string; createdAt: string }> }>("/analysis/tasks/logs/list", { taskId }, token),
  listReports: (token: string, taskId: string) => post<{ items: Array<{ id: string; instrumentId: string; result: { source: string; results: IndicatorResult[] }; createdAt: string }> }>("/analysis/reports/list", { taskId }, token),
  createSchedule: (token: string, input: { name: string; kind: "analysis" | "alert-scan"; intervalMinutes: number; strategyId: string | null }) => post<ScheduledJob>("/automation/schedules/create", input, token),
  listSchedules: (token: string) => post<{ items: ScheduledJob[] }>("/automation/schedules/list", {}, token),
  createAlert: (token: string, input: { instrumentId: string; direction: "above" | "below"; threshold: number; cooldownMinutes: number }) => post<AlertRule>("/automation/alerts/create", input, token),
  listAlerts: (token: string) => post<{ items: AlertRule[] }>("/automation/alerts/list", {}, token),
  evaluateAlerts: (token: string) => post<{ triggered: number }>("/automation/alerts/evaluate", {}, token),
  listAlertEvents: (token: string) => post<{ items: AlertEvent[] }>("/automation/alerts/events/list", {}, token),
  createNote: (token: string, input: { title: string; content: string; tags: string[]; instrumentId: string | null }) => post<Note>("/notes/create", input, token),
  listNotes: (token: string) => post<{ items: Note[] }>("/notes/list", {}, token),
  updateNote: (token: string, input: { id: string; title: string; content: string; tags: string[]; instrumentId: string | null }) => post<Note>("/notes/update", input, token),
  deleteNote: (token: string, id: string) => post<{ deleted: true }>("/notes/delete", { id }, token),
  exportData: (token: string) => post<UserExport>("/settings/data/export", {}, token),
  importData: (token: string, data: unknown) => post<{ imported: true }>("/settings/data/import", { data }, token),
  getAiConfig: (token: string) => post<AiConfig>("/settings/ai/get", {}, token),
  updateAiConfig: (token: string, input: { provider: "local" | "openai"; baseUrl?: string; model?: string; apiKey?: string }) => post<AiConfig>("/settings/ai/update", input, token),
  chat: (token: string, message: string) => post<{ provider: "local" | "openai"; content: string }>("/assistant/chat", { message }, token),
  marketOverview: (token: string) => post<{ instrumentCount: number; cachedBarCount: number; latestCacheAt: string | null }>("/market/overview", {}, token),
  marketSignals: (token: string) => post<{ items: MarketSignal[] }>("/market/signals", {}, token),
  informationLinks: (token: string) => post<{ groups: Array<{ label: string; links: Array<{ name: string; url: string }> }> }>("/market/info-links", {}, token),
  streamTask: (token: string, taskId: string) => new EventSource(`${apiBaseUrl}/stream/tasks/${encodeURIComponent(taskId)}?token=${encodeURIComponent(token)}`),
  streamWatchlist: (token: string) => new EventSource(`${apiBaseUrl}/stream/watchlist?token=${encodeURIComponent(token)}`)
};
