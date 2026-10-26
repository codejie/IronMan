import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { RuntimeConfig } from "./config";
import { failure, success } from "./contracts";
import { IronManDatabase } from "./db/database";
import { AppError, errors } from "./errors";
import { AssetsService } from "./services/assets-service";
import { AssistantConversationService } from "./services/assistant-conversation-service";
import {
  AssistantService,
  type AssistantReplyMetadata,
} from "./services/assistant-service";
import { AkShareMarketProvider } from "./market/akshare-provider";
import { AkShareTechnicalProvider } from "./market/akshare-technical-provider";
import { EastmoneyMarketProvider } from "./market/eastmoney-provider";
import { TencentMarketProvider } from "./market/tencent-provider";
import type { MarketDataProvider } from "./market/types";
import { AnalysisTaskService } from "./services/analysis-task-service";
import {
  AutomationScheduler,
  AutomationService,
} from "./services/automation-service";
import { BackupService } from "./services/backup-service";
import { AuthService, type PublicUser } from "./services/auth-service";
import {
  AiCandidateService,
  CANDIDATE_STRATEGIES,
} from "./services/ai-candidate-service";
import { IndicatorService } from "./services/indicator-service";
import { FundHistoryService } from "./services/fund-history-service";
import {
  HoldingDiagnosisService,
  holdingDiagnosisSettingsSchema,
} from "./services/holding-diagnosis-service";
import { createHoldingDiagnosisSources, readHoldingDiagnosisSource } from "./services/holding-diagnosis-sources";
import { MarketService } from "./services/market-service";
import {
  MarketSnapshotService,
  marketSnapshotSettingsSchema,
  marketSnapshotStatusSchema,
} from "./services/market-snapshot-service";
import { NoteService } from "./services/note-service";
import { SettingsService } from "./services/settings-service";
import { StrategyService } from "./services/strategy-service";
import {
  TrendIndicatorService,
  trendIndicatorCatalog,
} from "./services/trend-indicator-service";
import { TrendRunService } from "./services/trend-run-service";
import { TrendStrategyService } from "./services/trend-strategy-service";
import { ThirdPartyDataService } from "./services/third-party-data-service";
import { TradingCalendarService } from "./services/trading-calendar-service";

type AppVariables = {
  currentUser: PublicUser;
};

const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .openapi({ example: "investor@example.com" });
const passwordSchema = z
  .string()
  .min(12)
  .max(128)
  .openapi({ example: "a-strong-password" });
const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(["admin", "user"]),
  status: z.enum(["active", "disabled"]),
});
const sessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime(),
  user: publicUserSchema,
});
const emptyBodySchema = z.object({}).openapi("EmptyBody");
const assetTypeSchema = z.enum(["stock", "index", "fund"]);
const exchangeSchema = z.enum(["sh", "sz", "bj", "fund"]);
const sourceSchema = z.enum(["tencent", "eastmoney", "akshare"]);
const minutePointSchema = z.object({
  time: z.string(),
  price: z.number(),
  volume: z.number(),
  cumulativeAmount: z.number(),
});
const timeframeSchema = z.enum(["day", "week", "month"]);
const historyLimitSchema = z.number().int().min(1).max(640).default(180);
const indicatorTypeSchema = z.enum(["MA", "MACD", "RSI", "BOLL"]);
const instrumentSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  exchange: exchangeSchema,
  name: z.string(),
  assetType: assetTypeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const priceBarSchema = z.object({
  date: z.string(),
  open: z.number(),
  close: z.number(),
  high: z.number(),
  low: z.number(),
  volume: z.number(),
  amount: z.number().nullable().optional(),
  turnoverRate: z.number().nullable().optional(),
});
const marketSnapshotPointSchema = z.object({
  capturedAt: z.string().datetime(),
  tradeDate: z.string(),
  source: sourceSchema,
  captureMode: z.enum(["auto", "manual"]),
  open: z.number(),
  close: z.number(),
  high: z.number(),
  low: z.number(),
  volume: z.number(),
});
const fundHistoryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fundHistoryStateSchema = z.object({
  coveredFrom: fundHistoryDateSchema.nullable(),
  coveredTo: fundHistoryDateSchema.nullable(),
  dirtyFrom: fundHistoryDateSchema.nullable(),
  status: z.enum(["idle", "calculating", "dirty", "failed"]),
  lastError: z.string().nullable(),
  calculationVersion: z.number().int(),
  updatedAt: z.string().datetime(),
  tradeDayCount: z.number().int().nonnegative(),
});
const fundHistoryPointSchema = z.object({
  tradeDate: fundHistoryDateSchema,
  cashAvailable: z.number(),
  principal: z.number(),
  marketValue: z.number(),
  totalAssets: z.number(),
  externalCashFlow: z.number(),
  dailyProfit: z.number().nullable(),
  dailyReturn: z.number().nullable(),
  performanceIndex: z.number(),
  cumulativeProfit: z.number(),
  cumulativeProfitRate: z.number().nullable(),
  instrumentCount: z.number().int().nonnegative(),
  pricedCount: z.number().int().nonnegative(),
  carriedPriceCount: z.number().int().nonnegative(),
  missingPriceCount: z.number().int().nonnegative(),
  dataStatus: z.enum(["complete", "partial"]),
  calculationVersion: z.number().int(),
  calculatedAt: z.string().datetime(),
});
const fundHistoryResultSchema = z.object({
  summary: z.object({
    totalAssets: z.number(),
    marketValue: z.number(),
    cashAvailable: z.number(),
    principal: z.number(),
    cumulativeProfit: z.number(),
    cumulativeProfitRate: z.number().nullable(),
    maxDrawdown: z.number().nullable(),
  }),
  points: z.array(fundHistoryPointSchema),
  events: z.array(z.object({
    id: z.string(),
    tradeDate: fundHistoryDateSchema,
    kind: z.enum(["adjustment", "buy", "sell", "close", "dividend"]),
    label: z.string(),
    amount: z.number(),
    instrumentName: z.string().nullable(),
  })),
  state: fundHistoryStateSchema,
});
const thirdPartyTechnicalKindSchema = z.enum([
  "new_high",
  "uptrend",
  "high_volume",
  "rise_volume_price",
  "limit_up_pool",
]);
const thirdPartyTableValueSchema = z.union([z.string(), z.number(), z.null()]);
const thirdPartyTechnicalTableSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(
    z.object({
      values: z.record(z.string(), thirdPartyTableValueSchema),
      instrument: instrumentSchema
        .pick({
          id: true,
          code: true,
          exchange: true,
          name: true,
          assetType: true,
        })
        .nullable(),
    }),
  ),
  source: z.enum(["akshare", "tonghuashun", "eastmoney", "local"]),
  updatedAt: z.string().datetime(),
  notice: z.string().optional(),
});
const thirdPartyInfoGroupSchema = z.object({
  label: z.string(),
  links: z.array(
    z.object({
      name: z.string(),
      url: z.string().url(),
      needCode: z.boolean(),
      openInNewWindow: z.boolean(),
    }),
  ),
});
const candidateStrategySchema = z.enum(CANDIDATE_STRATEGIES);
const candidateSettingsSchema = z.object({
  enabled: z.boolean(),
  strategies: z.array(candidateStrategySchema).min(1),
  topN: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  explanationValidityDays: z.literal(10),
  maxValidityDays: z.literal(20),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  retentionDays: z.number().int().min(1).max(30),
});
const candidateRunSchema = z.object({
  id: z.string().uuid(),
  trigger: z.enum(["manual", "scheduled"]),
  tradeDate: z.string(),
  status: z.enum(["queued", "running", "completed", "partial", "failed", "cancelled"]),
  progress: z.number().int().min(0).max(100),
  requestedTopN: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  strategies: z.array(candidateStrategySchema),
  algorithmVersion: z.string(),
  marketRegime: z.unknown(),
  dataQuality: z.record(z.string(), z.unknown()),
  modelSnapshot: z.record(z.string(), z.unknown()),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

function responseSchema<T extends z.ZodType>(result: T) {
  return z.object({
    code: z.number().int(),
    message: z.string().optional(),
    result,
  });
}

function jsonBody<T extends z.ZodType>(schema: T) {
  return { content: { "application/json": { schema } } };
}

function authorizationToken(context: Context): string {
  const authorization = context.req.header("authorization");
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    throw errors.unauthenticated();
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (token.length === 0) {
    throw errors.unauthenticated();
  }
  return token;
}

function authenticated(
  auth: AuthService,
): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    context.set(
      "currentUser",
      await auth.authenticate(authorizationToken(context)),
    );
    await next();
  };
}

function administrator(): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    if (context.get("currentUser").role !== "admin") {
      throw errors.forbidden();
    }
    await next();
  };
}

export interface IronManRuntime {
  app: OpenAPIHono<{ Variables: AppVariables }>;
  close(): void;
  startScheduler(): void;
}

export function createApp(config: RuntimeConfig): IronManRuntime {
  const database = new IronManDatabase(config.databasePath);
  const auth = new AuthService(database, config);
  const settings = new SettingsService(database);
  const tradingCalendar = new TradingCalendarService(settings);
  const market = new MarketService(database, settings, [
    ...(config.marketProviders ?? [
      new AkShareMarketProvider({
        baseUrl: config.akshareProviderUrl,
        timeoutMs: config.akshareProviderTimeoutMs,
      }),
      new TencentMarketProvider(),
      new EastmoneyMarketProvider(),
    ]),
  ]);
  const thirdParty = new ThirdPartyDataService(
    database,
    market,
    undefined,
    new AkShareTechnicalProvider({
      baseUrl: config.akshareProviderUrl,
      timeoutMs: config.akshareProviderTimeoutMs,
    }),
  );
  const fundHistory = new FundHistoryService(database, market, tradingCalendar);
  const snapshots = new MarketSnapshotService(
    database,
    settings,
    tradingCalendar,
    market,
  );
  const assets = new AssetsService(database, market, fundHistory, snapshots);
  const indicators = new IndicatorService();
  const trendIndicators = new TrendIndicatorService();
  const assistantConversations = new AssistantConversationService(database);
  const assistant = new AssistantService(
    settings,
    assets,
    market,
    indicators,
    trendIndicators,
    thirdParty,
    assistantConversations,
  );
  const diagnosis = new HoldingDiagnosisService(
    database,
    settings,
    market,
    trendIndicators,
    tradingCalendar,
    {
      generate: (input) => assistant.generateHoldingDiagnosis(input),
      getModelSnapshot: (userId) => ({ ...assistant.getHoldingDiagnosisModelSnapshot(userId) }),
    },
    createHoldingDiagnosisSources({
      baseUrl: config.akshareProviderUrl,
      timeoutMs: config.akshareProviderTimeoutMs,
    }),
    undefined,
    readHoldingDiagnosisSource,
  );
  const candidates = new AiCandidateService(
    database,
    settings,
    market,
    thirdParty,
    tradingCalendar,
    {
      generate: (userId, input) => assistant.generateCandidateExplanation(userId, input),
      getModelSnapshot: (userId) => ({ ...assistant.getHoldingDiagnosisModelSnapshot(userId) }),
    },
  );
  const strategies = new StrategyService(database, market);
  const tasks = new AnalysisTaskService(
    database,
    strategies,
    market,
    indicators,
  );
  const trendStrategies = new TrendStrategyService(database, market);
  const trendRuns = new TrendRunService(
    database,
    trendStrategies,
    market,
    trendIndicators,
  );
  const automation = new AutomationService(
    database,
    market,
    strategies,
    tasks,
    snapshots,
    diagnosis,
    candidates,
  );
  const scheduler = new AutomationScheduler(automation);
  const notes = new NoteService(database, market);
  const backup = new BackupService(database);
  const app = new OpenAPIHono<{ Variables: AppVariables }>();
  const allowedOrigins = new Set(
    (
      process.env.CORS_ORIGINS ??
      "http://127.0.0.1:6100,http://localhost:6100"
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : ""),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["POST", "GET", "OPTIONS"],
    }),
  );

  app.onError((error, context) => {
    if (error instanceof AppError) {
      return context.json(failure(error.code, error.message), error.status);
    }
    console.error(error);
    return context.json(failure(10000, "服务器内部错误"), 500);
  });

  app.notFound((context) => context.json(failure(10006, "接口不存在"), 404));

  const holdingDiagnosisMethodSchema = z.object({
    kind: z.enum(["ai_analysis", "local_function", "hybrid_analysis"]),
    name: z.string(),
    version: z.string().optional(),
    parameters: z.record(z.string(), z.number()).optional(),
    dataWindow: z.number().int().nonnegative().optional(),
    rationale: z.string(),
    limitations: z.string().optional(),
  });
  const holdingDiagnosisRecommendationSchema = z.object({
    direction: z.enum([
      "add_evaluation",
      "reduce_evaluation",
      "hold",
      "observe",
      "research_further",
    ]),
    action: z.string().max(120).optional(),
    timing: z.string(),
    referencePriceLow: z.number().nullable(),
    referencePriceHigh: z.number().nullable(),
    invalidationPrice: z.number().nullable(),
    validUntil: z.string().nullable(),
    uncertainty: z.string(),
  });
  const holdingDiagnosisTurningPointSchema = z.object({
    date: z.string(),
    direction: z.enum(["bullish", "bearish"]),
    price: z.number().nullable(),
    title: z.string(),
    reason: z.string(),
    methods: z.array(holdingDiagnosisMethodSchema),
  });
  const holdingDiagnosisItemSchema = z.object({
    id: z.string().uuid(),
    instrument: instrumentSchema.pick({
      id: true,
      code: true,
      exchange: true,
      name: true,
      assetType: true,
    }),
    quantity: z.number(),
    averageCost: z.number().nullable(),
    currentPrice: z.number().nullable(),
    profit: z.number().nullable(),
    dataQuality: z.enum(["complete", "partial", "stale", "unavailable"]),
    body: z.string().max(600),
    analysis: z.string(),
    errorMessage: z.string().nullable().optional(),
    methods: z.array(holdingDiagnosisMethodSchema),
    recommendation: holdingDiagnosisRecommendationSchema,
    chart: z.object({
      bars: z.array(priceBarSchema),
      source: sourceSchema.nullable(),
      indicators: z.array(
        z.object({
          indicatorId: z.string(),
          lines: z.record(z.string(), z.array(z.number().nullable())),
          signals: z.array(
            z.object({
              date: z.string(),
              direction: z.enum(["bullish", "bearish", "neutral"]),
              strength: z.number(),
              reason: z.string(),
            }),
          ),
          turningPoints: z.array(
            z.object({
              date: z.string(),
              direction: z.enum(["bullish", "bearish"]),
              level: z.enum(["info", "warning", "risk"]),
              title: z.string(),
              reason: z.string(),
              price: z.number().nullable(),
              indicatorId: z.string(),
            }),
          ),
        }),
      ),
      turningPoints: z.array(holdingDiagnosisTurningPointSchema),
    }),
  });
  const holdingDiagnosisSourceSchema = z.object({
    id: z.string().uuid(),
    sourceId: z.string(),
    sourceName: z.string(),
    type: z.enum(["market", "disclosure", "news", "reference"]),
    title: z.string(),
    publishedAt: z.string().nullable(),
    fetchedAt: z.string().datetime(),
    availability: z.enum(["available", "stale", "failed", "link_only"]),
    url: z.string().url(),
    itemId: z.string().uuid().nullable(),
    summary: z.string().max(600).nullable(),
    highlights: z.array(z.string().max(160)).max(8),
    externalId: z.string().nullable(),
    origin: z.enum(["official", "licensed", "aggregated", "discussion"]).nullable(),
    contentHash: z.string().nullable(),
    retrievedAt: z.string().datetime().nullable(),
    summaryKind: z.enum(["ai", "local_excerpt", "metadata_only"]),
    sourceInsight: z.object({
      sourceId: z.string(),
      summary: z.string().max(200),
      keyFacts: z.array(z.string().max(160)).max(3),
      marketImpact: z.enum(["positive", "negative", "mixed", "unclear"]),
      confidence: z.enum(["high", "medium", "low"]),
    }).nullable(),
  });
  const holdingDiagnosisAiStatusSchema = z.object({
    state: z.enum(["running", "completed", "local", "timeout", "unavailable"]),
    model: z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string(),
    }),
    message: z.string(),
    timeoutSeconds: z.number().int().positive().optional(),
  });
  const holdingDiagnosisRunSchema = z.object({
    id: z.string().uuid(),
    trigger: z.enum(["manual", "scheduled"]),
    status: z.enum(["queued", "running", "completed", "partial", "failed", "cancelled"]),
    progress: z.number().int().min(0).max(100),
    scheduledTradeDate: z.string().nullable(),
    errorMessage: z.string().nullable(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    reportId: z.string().uuid().nullable(),
  });
  const holdingDiagnosisReportSchema = z.object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    body: z.string().max(600),
    errorMessage: z.string().nullable(),
    aiStatus: holdingDiagnosisAiStatusSchema,
    marketAsOf: z.string().nullable(),
    createdAt: z.string().datetime(),
    items: z.array(holdingDiagnosisItemSchema),
    sources: z.array(holdingDiagnosisSourceSchema),
  });
  const holdingDiagnosisReportListSchema = z.object({
    items: z.array(
      holdingDiagnosisRunSchema.pick({
        id: true,
        trigger: true,
        status: true,
        progress: true,
        errorMessage: true,
        createdAt: true,
        reportId: true,
      }),
    ),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/settings/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Current user's holding diagnosis settings",
          content: {
            "application/json": {
              schema: responseSchema(holdingDiagnosisSettingsSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(diagnosis.getSettings(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/settings/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(holdingDiagnosisSettingsSchema.partial()) },
      responses: {
        200: {
          description: "Updated holding diagnosis settings",
          content: {
            "application/json": {
              schema: responseSchema(holdingDiagnosisSettingsSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          diagnosis.updateSettings(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/sources/catalog",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Vetted holding diagnosis source catalog",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(
                    z.object({
                      id: z.string(),
                      label: z.string(),
                      description: z.string(),
                      kind: z.enum(["market", "external"]),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) => context.json(success({ items: diagnosis.sourceCatalog() }), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/start",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        202: {
          description: "Queued manual holding diagnosis",
          content: {
            "application/json": {
              schema: responseSchema(holdingDiagnosisRunSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(diagnosis.start(context.get("currentUser").id, "manual")),
        202,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/runs/list",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ limit: z.number().int().min(1).max(200).default(60) })),
      },
      responses: {
        200: {
          description: "Current user's diagnosis run archive",
          content: {
            "application/json": {
              schema: responseSchema(holdingDiagnosisReportListSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          diagnosis.listReports(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/runs/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Current user's diagnosis run",
          content: {
            "application/json": {
              schema: responseSchema(holdingDiagnosisRunSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          diagnosis.getRun(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/reports/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Current user's holding diagnosis report",
          content: {
            "application/json": {
              schema: responseSchema(holdingDiagnosisReportSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          diagnosis.getReport(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );

  const holdingDiagnosisDeleteSchema = z.object({
    reportIds: z.array(z.string().uuid()).min(1).max(200),
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/reports/delete",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ id: z.string().uuid() })),
      },
      responses: {
        200: {
          description: "Deleted a holding diagnosis report",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.number().int() })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          diagnosis.deleteReports(context.get("currentUser").id, {
            reportIds: [context.req.valid("json").id],
          }),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/reports/delete-batch",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(holdingDiagnosisDeleteSchema) },
      responses: {
        200: {
          description: "Deleted current user's holding diagnosis reports",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.number().int() })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          diagnosis.deleteReports(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/holding-diagnosis/reports/delete-all",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({})) },
      responses: {
        200: {
          description: "Deleted the current user's holding diagnosis report archive",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.number().int() })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(diagnosis.deleteAllReports(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/health",
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Service health",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  status: z.literal("ok"),
                  time: z.string().datetime(),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ status: "ok" as const, time: new Date().toISOString() }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/auth/register",
      request: {
        body: jsonBody(
          z.object({
            email: emailSchema,
            password: passwordSchema,
            displayName: z.string().trim().min(1).max(80),
          }),
        ),
      },
      responses: {
        201: {
          description: "Registered",
          content: {
            "application/json": { schema: responseSchema(sessionSchema) },
          },
        },
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(success(await auth.register(input)), 201);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/indicators/calculate",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            instrumentId: z.string().uuid(),
            indicators: z.array(indicatorTypeSchema).min(1),
            refresh: z.boolean().default(false),
            limit: historyLimitSchema,
          }),
        ),
      },
      responses: {
        200: {
          description: "TA-Lib compatible indicator results",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  source: sourceSchema,
                  bars: z.array(
                    z.object({
                      date: z.string(),
                      open: z.number(),
                      close: z.number(),
                      high: z.number(),
                      low: z.number(),
                      volume: z.number(),
                    }),
                  ),
                  results: z.array(
                    z.object({
                      type: indicatorTypeSchema,
                      lines: z.record(
                        z.string(),
                        z.array(z.number().nullable()),
                      ),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      const history = await market.getHistory(
        context.get("currentUser").id,
        input.instrumentId,
        "day",
        input.refresh,
        input.limit,
      );
      return context.json(
        success({
          source: history.source,
          bars: history.bars,
          results: indicators.calculate(history.bars, input.indicators),
        }),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/auth/login",
      request: {
        body: jsonBody(
          z.object({ email: emailSchema, password: passwordSchema }),
        ),
      },
      responses: {
        200: {
          description: "Session",
          content: {
            "application/json": { schema: responseSchema(sessionSchema) },
          },
        },
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(await auth.login(input.email, input.password)),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/auth/refresh",
      request: { body: jsonBody(z.object({ token: z.string().min(1) })) },
      responses: {
        200: {
          description: "Refreshed session",
          content: {
            "application/json": { schema: responseSchema(sessionSchema) },
          },
        },
      },
    }),
    async (context) => {
      const { token } = context.req.valid("json");
      return context.json(success(await auth.refresh(token)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/auth/logout",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Logged out",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ loggedOut: z.literal(true) })),
            },
          },
        },
      },
    }),
    async (context) => {
      await auth.logout(authorizationToken(context));
      return context.json(success({ loggedOut: true as const }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/account/me",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Current user",
          content: {
            "application/json": { schema: responseSchema(publicUserSchema) },
          },
        },
      },
    }),
    (context) => context.json(success(context.get("currentUser")), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/account/profile/update",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({ displayName: z.string().trim().min(1).max(80) }),
        ),
      },
      responses: {
        200: {
          description: "Updated profile",
          content: {
            "application/json": { schema: responseSchema(publicUserSchema) },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(
          auth.updateProfile(context.get("currentUser").id, input.displayName),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/account/password/change",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            currentPassword: passwordSchema,
            newPassword: passwordSchema,
          }),
        ),
      },
      responses: {
        200: {
          description: "Password changed",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ changed: z.literal(true) })),
            },
          },
        },
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      await auth.changePassword(
        context.get("currentUser").id,
        input.currentPassword,
        input.newPassword,
      );
      return context.json(success({ changed: true as const }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Current user's settings",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(
                    z.object({
                      key: z.string(),
                      value: z.unknown(),
                      updatedAt: z.string().datetime(),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ items: settings.list(context.get("currentUser").id) }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/upsert",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            key: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/),
            value: z.unknown(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Stored setting",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  key: z.string(),
                  value: z.unknown(),
                  updatedAt: z.string().datetime(),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(
          settings.upsert(
            context.get("currentUser").id,
            input.key,
            input.value,
          ),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/admin/users/list",
      middleware: [authenticated(auth), administrator()],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Users",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(publicUserSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) => context.json(success({ items: auth.listUsers() }), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/admin/users/status",
      middleware: [authenticated(auth), administrator()],
      request: {
        body: jsonBody(
          z.object({
            userId: z.string().uuid(),
            status: z.enum(["active", "disabled"]),
          }),
        ),
      },
      responses: {
        200: {
          description: "User status updated",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ updated: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      auth.updateUserStatus(
        context.get("currentUser").id,
        input.userId,
        input.status,
      );
      return context.json(success({ updated: true as const }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/instruments/upsert",
      middleware: [authenticated(auth), administrator()],
      request: {
        body: jsonBody(
          z.object({
            code: z.string().trim().min(1).max(24),
            exchange: exchangeSchema,
            name: z.string().trim().min(1).max(120),
            assetType: assetTypeSchema,
          }),
        ),
      },
      responses: {
        200: {
          description: "Stored instrument",
          content: {
            "application/json": { schema: responseSchema(instrumentSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(market.upsertInstrument(context.req.valid("json"))),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/instruments/search",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            query: z.string().trim().min(1).max(120),
            assetType: assetTypeSchema.optional(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Matching instruments",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(instrumentSchema) }),
              ),
            },
          },
        },
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(
        success({ items: await market.search(input.query, input.assetType) }),
        200,
      );
    },
  );

  const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const calendarYearSchema = z.number().int().min(2000).max(2100);
  const tradingCalendarResponseSchema = z.object({
    year: calendarYearSchema,
    tradeDays: z.array(calendarDateSchema).max(366),
    nonTradingDays: z.array(calendarDateSchema).max(366),
  });
  const tradingCalendarUpdateSchema = z
    .object({
      year: calendarYearSchema.optional(),
      tradeDays: z.array(calendarDateSchema).max(366).optional(),
      nonTradingDays: z.array(calendarDateSchema).max(366).optional(),
    })
    .refine(
      (input) =>
        input.tradeDays !== undefined || input.nonTradingDays !== undefined,
      { message: "缺少交易日配置" },
    );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/trading-calendar/get",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ year: calendarYearSchema.optional() })),
      },
      responses: {
        200: {
          description: "User trading calendar",
          content: {
            "application/json": {
              schema: responseSchema(tradingCalendarResponseSchema),
            },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(tradingCalendar.getYear(context.get("currentUser").id, input.year)),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/trading-calendar/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(tradingCalendarUpdateSchema) },
      responses: {
        200: {
          description: "Updated trading calendar",
          content: {
            "application/json": {
              schema: responseSchema(tradingCalendarResponseSchema),
            },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      const userId = context.get("currentUser").id;
      return context.json(success(tradingCalendar.update(userId, input)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/data-sources/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "User data source config",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ primary: sourceSchema, fallback: sourceSchema }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(market.getDataSourceConfig(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/data-sources/update",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({ primary: sourceSchema, fallback: sourceSchema }),
        ),
      },
      responses: {
        200: {
          description: "Updated data source config",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ primary: sourceSchema, fallback: sourceSchema }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          market.setDataSourceConfig(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/intraday-source/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "User intraday display source preference",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ source: z.enum(["snapshot", "realtime"]) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ source: market.getIntradayDisplaySource(context.get("currentUser").id) }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/intraday-source/update",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({ source: z.enum(["snapshot", "realtime"]) }),
        ),
      },
      responses: {
        200: {
          description: "Updated intraday display source preference",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ source: z.enum(["snapshot", "realtime"]) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(market.setIntradayDisplaySource(
          context.get("currentUser").id,
          context.req.valid("json").source,
        )),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/market/refresh",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Refreshed current user's referenced instruments",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  requested: z.number().int(),
                  refreshed: z.number().int(),
                  failed: z.number().int(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (context) => {
      const userId = context.get("currentUser").id;
      return context.json(
        success(
          await market.refreshInstruments(
            userId,
            assets.listReferencedInstrumentIds(userId),
          ),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/market-snapshots/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Current user's intraday market snapshot settings",
          content: {
            "application/json": {
              schema: responseSchema(marketSnapshotSettingsSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(snapshots.getSettings(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/market-snapshots/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(marketSnapshotSettingsSchema.partial()) },
      responses: {
        200: {
          description: "Updated intraday market snapshot settings",
          content: {
            "application/json": {
              schema: responseSchema(marketSnapshotSettingsSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          snapshots.updateSettings(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/market-snapshots/status",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Current user's intraday market snapshot status",
          content: {
            "application/json": {
              schema: responseSchema(marketSnapshotStatusSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(snapshots.getStatus(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/market-snapshots/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Deleted current user's intraday market snapshots",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ deleted: z.number().int().nonnegative() }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(snapshots.deleteSnapshots(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/minute",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            instrumentId: z.string().uuid(),
            date: z
              .string()
              .regex(/^\d{4}([-/]?\d{2}){2}$/)
              .optional(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Intraday minute line",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  source: sourceSchema,
                  date: z.string(),
                  points: z.array(minutePointSchema),
                  benchmark: z
                    .object({
                      code: z.string(),
                      name: z.string(),
                      points: z.array(minutePointSchema),
                    })
                    .nullable(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(
          await market.getIntradayMinute(context.get("currentUser").id, input.instrumentId, input.date),
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/history",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            instrumentId: z.string().uuid(),
            timeframe: timeframeSchema.default("day"),
            refresh: z.boolean().default(false),
            limit: historyLimitSchema,
          }),
        ),
      },
      responses: {
        200: {
          description: "Historical OHLCV data",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  source: sourceSchema,
                  bars: z.array(
                    z.object({
                      date: z.string(),
                      open: z.number(),
                      close: z.number(),
                      high: z.number(),
                      low: z.number(),
                      volume: z.number(),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(
          await market.getHistory(
            context.get("currentUser").id,
            input.instrumentId,
            input.timeframe,
            input.refresh,
            input.limit,
          ),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/snapshots/series",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            instrumentId: z.string().uuid(),
            startAt: z.string().datetime(),
            endAt: z.string().datetime(),
          }).refine((input) => input.startAt <= input.endAt, {
            message: "分时数据时间范围无效",
          }),
        ),
      },
      responses: {
        200: {
          description: "Market snapshot series compatible with holdings intraday dialog",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(marketSnapshotPointSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(
        success({
          items: snapshots.listSeries(
            context.get("currentUser").id,
            input.instrumentId,
            input.startAt,
            input.endAt,
          ),
        }),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/overview",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Market cache overview",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  instrumentCount: z.number().int(),
                  cachedBarCount: z.number().int(),
                  latestCacheAt: z.string().datetime().nullable(),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) => context.json(success(market.overview()), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/signals",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Watchlist technical signals",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(
                    z.object({
                      instrumentId: z.string().uuid(),
                      name: z.string(),
                      code: z.string(),
                      price: z.number(),
                      signals: z.array(z.string()),
                      source: sourceSchema,
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    async (context) =>
      context.json(
        success({
          items: await market.signalsForWatchlist(
            context.get("currentUser").id,
          ),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/info-links",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Curated public market links",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  groups: z.array(
                    z.object({
                      label: z.string(),
                      links: z.array(
                        z.object({ name: z.string(), url: z.string().url() }),
                      ),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(success({ groups: market.informationLinks() }), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/third-party/technical/query",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            kind: thirdPartyTechnicalKindSchema,
            category: z.number().int().min(0).max(3).optional(),
            days: z.number().int().min(1).max(30).optional(),
            date: z
              .string()
              .regex(/^\d{4}([-/]?\d{2}){2}$/)
              .optional(),
          }),
        ),
      },
      responses: {
        200: {
          description:
            "Third-party technical ranking table with a user-isolated local fallback",
          content: {
            "application/json": {
              schema: responseSchema(thirdPartyTechnicalTableSchema),
            },
          },
        },
      },
    }),
    async (context) =>
      context.json(
        success(
          await thirdParty.technical(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/third-party/info-links",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Curated public market and news destinations",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ groups: z.array(thirdPartyInfoGroupSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(success({ groups: thirdParty.informationLinks() }), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/third-party/market-cloud",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Embedded third-party market cloud configuration",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  title: z.string(),
                  url: z.string().url(),
                  openUrl: z.string().url(),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) => context.json(success(thirdParty.marketCloud()), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/watchlist/create",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            instrumentId: z.string().uuid(),
            note: z.string().max(500).default(""),
            targetPrice: z.number().positive().nullable().optional(),
          }),
        ),
      },
      responses: {
        201: {
          description: "Created watchlist entry",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  id: z.string().uuid(),
                  note: z.string(),
                  targetPrice: z.number().nullable(),
                  sortOrder: z.number().int(),
                  instrument: instrumentSchema.pick({
                    id: true,
                    code: true,
                    exchange: true,
                    name: true,
                    assetType: true,
                  }),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assets.createWatchlistEntry(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  const watchlistEntrySchema = z.object({
    id: z.string().uuid(),
    note: z.string(),
    targetPrice: z.number().nullable(),
    sortOrder: z.number().int(),
    instrument: instrumentSchema.pick({
      id: true,
      code: true,
      exchange: true,
      name: true,
      assetType: true,
    }),
  });
  const watchlistWorkspaceEntrySchema = watchlistEntrySchema.extend({
    isHeld: z.boolean(),
    latestPrice: z.number().nullable(),
    quoteDate: z.string().nullable(),
    previousClose: z.number().nullable(),
    openPrice: z.number().nullable(),
    highPrice: z.number().nullable(),
    lowPrice: z.number().nullable(),
    priceChange: z.number().nullable(),
    priceChangeRate: z.number().nullable(),
    amplitudeRate: z.number().nullable(),
    volumeRatio: z.number().nullable(),
    turnoverRate: z.number().nullable(),
    targetPriceDifference: z.number().nullable(),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/watchlist/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Current user's watchlist",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(watchlistEntrySchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ items: assets.listWatchlist(context.get("currentUser").id) }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/watchlist/workspace",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ refresh: z.boolean().default(false) })),
      },
      responses: {
        200: {
          description: "Batman-style watchlist workspace",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(watchlistWorkspaceEntrySchema) }),
              ),
            },
          },
        },
      },
    }),
    async (context) =>
      context.json(
        success(
          await assets.getWatchlistWorkspace(
            context.get("currentUser").id,
            context.req.valid("json").refresh,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/watchlist/update",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            id: z.string().uuid(),
            note: z.string().max(500).optional(),
            targetPrice: z.number().positive().nullable().optional(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Updated watchlist entry",
          content: {
            "application/json": {
              schema: responseSchema(watchlistEntrySchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assets.updateWatchlistEntry(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/watchlist/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Deleted watchlist entry",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) => {
      assets.deleteWatchlistEntry(
        context.get("currentUser").id,
        context.req.valid("json").id,
      );
      return context.json(success({ deleted: true as const }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/cash/adjust",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            amount: z.number().finite(),
            note: z.string().max(500).default(""),
          }),
        ),
      },
      responses: {
        200: {
          description: "Adjusted cash",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ available: z.number() })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          available: assets.adjustCash(
            context.get("currentUser").id,
            context.req.valid("json").amount,
            context.req.valid("json").note,
          ),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/cash/summary",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Available cash",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ available: z.number() })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ available: assets.getCash(context.get("currentUser").id) }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/funds/history",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({
          startDate: fundHistoryDateSchema,
          endDate: fundHistoryDateSchema,
        })),
      },
      responses: {
        200: {
          description: "User fund history",
          content: { "application/json": { schema: responseSchema(fundHistoryResultSchema) } },
        },
      },
    }),
    async (context) => context.json(
      success(await fundHistory.getHistory(context.get("currentUser").id, context.req.valid("json"))),
      200,
    ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/funds/history/status",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "User fund history status",
          content: { "application/json": { schema: responseSchema(fundHistoryStateSchema) } },
        },
      },
    }),
    (context) => context.json(success(fundHistory.getStatus(context.get("currentUser").id)), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/funds/history/recalculate",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Recalculated user fund history",
          content: { "application/json": { schema: responseSchema(fundHistoryResultSchema) } },
        },
      },
    }),
    async (context) => context.json(
      success(await fundHistory.recalculate(context.get("currentUser").id)),
      200,
    ),
  );

  const holdingInputSchema = z.object({
    instrumentId: z.string().uuid(),
    quantity: z.number().positive(),
    price: z.number().nonnegative(),
    fee: z.number().nonnegative().default(0),
    occurredAt: z.string().datetime(),
    note: z.string().max(500).optional(),
  });
  const holdingSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(["active", "closed"]),
    quantity: z.number(),
    cost: z.number(),
    averageCost: z.number(),
    instrument: instrumentSchema.pick({
      id: true,
      code: true,
      exchange: true,
      name: true,
      assetType: true,
    }),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  const holdingActionSchema = z.enum(["buy", "sell", "interest"]);
  const holdingOperationSchema = z.object({
    id: z.string().uuid(),
    action: holdingActionSchema,
    quantity: z.number(),
    price: z.number(),
    fee: z.number(),
    cashImpact: z.number(),
    occurredAt: z.string().datetime(),
    note: z.string(),
  });
  const holdingChartTraceSchema = z.object({
    date: z.string(),
    quantity: z.number(),
    netCost: z.number(),
    averageCost: z.number().nullable(),
    marketValue: z.number(),
    profit: z.number(),
  });
  const holdingWorkspaceRecordSchema = holdingSchema.extend({
    currentPrice: z.number().nullable(),
    quoteDate: z.string().nullable(),
    priceChange: z.number().nullable(),
    priceChangeRate: z.number().nullable(),
    marketValue: z.number().nullable(),
    profit: z.number().nullable(),
    profitRate: z.number().nullable(),
  });
  const holdingWorkspaceSchema = z.object({
    summary: z.object({
      cashAvailable: z.number(),
      totalCost: z.number(),
      totalMarketValue: z.number(),
      totalAssets: z.number(),
      principal: z.number(),
      profit: z.number(),
      profitRate: z.number().nullable(),
    }),
    active: z.array(holdingWorkspaceRecordSchema),
    closed: z.array(holdingWorkspaceRecordSchema),
  });
  const batmanHoldingWorkspaceRecordSchema =
    holdingWorkspaceRecordSchema.extend({
      costCashFlow: z.number(),
      quantityRatio: z.number().nullable(),
      costRatio: z.number().nullable(),
      averagePriceDifference: z.number().nullable(),
      marketValueRatio: z.number().nullable(),
      profitRatio: z.number().nullable(),
      dailyDifference: z.number().nullable(),
      dailyDifferenceRate: z.number().nullable(),
    });
  const batmanHoldingWorkspaceSchema = z.object({
    summary: holdingWorkspaceSchema.shape.summary,
    active: z.array(batmanHoldingWorkspaceRecordSchema),
    closed: z.array(batmanHoldingWorkspaceRecordSchema),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(holdingInputSchema) },
      responses: {
        201: {
          description: "Created holding",
          content: {
            "application/json": { schema: responseSchema(holdingSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assets.createHolding(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/detail/chart",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            id: z.string().uuid(),
            refresh: z.boolean().default(false),
          }),
        ),
      },
      responses: {
        200: {
          description: "Holding chart detail",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  holding: holdingSchema,
                  transactions: z.array(holdingOperationSchema),
                  bars: z.array(priceBarSchema),
                  trace: z.array(holdingChartTraceSchema),
                  macdLines: z.record(
                    z.string(),
                    z.array(z.number().nullable()),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(
          await assets.getHoldingChart(
            context.get("currentUser").id,
            input.id,
            input.refresh,
          ),
        ),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/transaction",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            holdingId: z.string().uuid(),
            action: holdingActionSchema,
            quantity: z.number().nonnegative(),
            price: z.number().nonnegative(),
            fee: z.number().nonnegative().default(0),
            occurredAt: z.string().datetime(),
            note: z.string().max(500).optional(),
          }),
        ),
      },
      responses: {
        201: {
          description: "Recorded transaction",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ id: z.string().uuid() })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assets.recordHoldingTransaction(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/transaction/delete",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            holdingId: z.string().uuid(),
            transactionId: z.string().uuid(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Deleted holding transaction",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assets.deleteHoldingTransaction(
            context.get("currentUser").id,
            context.req.valid("json").holdingId,
            context.req.valid("json").transactionId,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Deleted holding",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assets.deleteHolding(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Holdings and cash",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(holdingSchema),
                  cashAvailable: z.number(),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(assets.listHoldings(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/workspace",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ refresh: z.boolean().default(false) })),
      },
      responses: {
        200: {
          description: "Batman-style holdings workspace",
          content: {
            "application/json": {
              schema: responseSchema(holdingWorkspaceSchema),
            },
          },
        },
      },
    }),
    async (context) =>
      context.json(
        success(
          await assets.getHoldingWorkspace(
            context.get("currentUser").id,
            context.req.valid("json").refresh,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/batman-workspace",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ refresh: z.boolean().default(false) })),
      },
      responses: {
        200: {
          description: "Batman-compatible holding display workspace",
          content: {
            "application/json": {
              schema: responseSchema(batmanHoldingWorkspaceSchema),
            },
          },
        },
      },
    }),
    async (context) =>
      context.json(
        success(
          await assets.getBatmanHoldingWorkspace(
            context.get("currentUser").id,
            context.req.valid("json").refresh,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/detail",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Holding detail",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  holding: holdingSchema,
                  transactions: z.array(holdingOperationSchema),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assets.getHoldingDetail(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );

  const strategySchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    instrumentIds: z.array(z.string().uuid()),
    indicators: z.array(indicatorTypeSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  const taskSchema = z.object({
    id: z.string().uuid(),
    strategyId: z.string().uuid(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    progress: z.number().int(),
    errorMessage: z.string().nullable(),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/strategies/create",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            name: z.string().trim().min(1).max(120),
            instrumentIds: z.array(z.string().uuid()).min(1).max(100),
            indicators: z.array(indicatorTypeSchema).min(1).max(20),
          }),
        ),
      },
      responses: {
        201: {
          description: "Created strategy",
          content: {
            "application/json": { schema: responseSchema(strategySchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          strategies.create(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/strategies/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "User strategies",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(strategySchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ items: strategies.list(context.get("currentUser").id) }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/tasks/start",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ strategyId: z.string().uuid() })) },
      responses: {
        202: {
          description: "Queued analysis task",
          content: {
            "application/json": { schema: responseSchema(taskSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          tasks.start(
            context.get("currentUser").id,
            context.req.valid("json").strategyId,
          ),
        ),
        202,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/tasks/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "User analysis tasks",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ items: z.array(taskSchema) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ items: tasks.list(context.get("currentUser").id) }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/tasks/retry",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ taskId: z.string().uuid() })) },
      responses: {
        202: {
          description: "Retried analysis task",
          content: {
            "application/json": { schema: responseSchema(taskSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          tasks.retry(
            context.get("currentUser").id,
            context.req.valid("json").taskId,
          ),
        ),
        202,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/tasks/logs/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ taskId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Task logs",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(
                    z.object({
                      id: z.string().uuid(),
                      level: z.enum(["info", "error"]),
                      message: z.string(),
                      createdAt: z.string().datetime(),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: tasks.listLogs(
            context.get("currentUser").id,
            context.req.valid("json").taskId,
          ),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/reports/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ taskId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Task reports",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(
                    z.object({
                      id: z.string().uuid(),
                      instrumentId: z.string().uuid(),
                      result: z.unknown(),
                      createdAt: z.string().datetime(),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: tasks.listReports(
            context.get("currentUser").id,
            context.req.valid("json").taskId,
          ),
        }),
        200,
      ),
  );

  const trendScopeSchema = z.enum([
    "holdings",
    "watchlist",
    "custom",
    "all",
    "holdings_watchlist",
  ]);
  const trendRangeSchema = z.object({
    preset: z.enum(["3m", "6m", "1y", "2y", "custom"]),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  });
  const trendIndicatorSchema = z.object({
    indicatorId: z.enum([
      "MA",
      "SAR",
      "ADX",
      "MACD",
      "MACDEXT",
      "RSI",
      "MOM",
      "KDJ",
      "BOLL",
      "ATR",
      "NATR",
      "OBV",
      "AD",
      "VWAP",
      "AVGPRICE",
      "MEDPRICE",
      "CDLHAMMER",
      "CDLENGULFING",
      "CDLMORNINGSTAR",
      "CDLDOJI",
      "CDLEVENINGSTAR",
      "CDL3WHITESOLDIERS",
      "CDL3BLACKCROWS",
      "CDLDARKCLOUDCOVER",
      "HT_DCPERIOD",
      "HT_DCPHASE",
    ]),
    parameters: z.record(z.string(), z.number()).optional(),
    enabled: z.boolean().optional(),
    displayOrder: z.number().int().min(0).max(100).optional(),
  });
  const trendCatalogItemSchema = z.object({
    id: z.string(),
    label: z.string(),
    category: z.string(),
    description: z.string(),
    usageHint: z.string(),
    detail: z.object({
      meaning: z.string(),
      usage: z.string(),
      trend: z.string(),
    }),
    parameters: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        defaultValue: z.number(),
        min: z.number(),
        max: z.number(),
        step: z.number().optional(),
      }),
    ),
    lines: z.array(z.string()),
    chart: z.enum(["main", "sub", "hidden"]),
  });
  const trendStrategyInputSchema = z.object({
    name: z.string().trim().min(1).max(120),
    remarks: z.string().max(1_000).optional(),
    targetScope: trendScopeSchema,
    dataRange: trendRangeSchema,
    reportWindow: z.enum(["1d", "3d", "7d", "30d", "all"]),
    customInstrumentIds: z.array(z.string().uuid()).max(2_000).optional(),
    indicators: z.array(trendIndicatorSchema).min(1).max(26),
    backtestConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  });
  const trendStrategySchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    remarks: z.string(),
    targetScope: trendScopeSchema,
    dataRange: trendRangeSchema,
    reportWindow: z.enum(["1d", "3d", "7d", "30d", "all"]),
    backtestConfig: z.record(z.string(), z.unknown()).nullable(),
    customInstrumentIds: z.array(z.string().uuid()),
    indicators: z.array(trendIndicatorSchema),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  const trendRunSchema = z.object({
    id: z.string().uuid(),
    strategyId: z.string().uuid(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    progress: z.number().int(),
    targetTotal: z.number().int(),
    targetCompleted: z.number().int(),
    errorMessage: z.string().nullable(),
    cancelRequested: z.boolean(),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    overallDirection: z.enum(["bullish", "bearish", "neutral"]).nullable(),
  });
  const trendInstrumentSchema = instrumentSchema.pick({
    id: true,
    code: true,
    exchange: true,
    name: true,
    assetType: true,
  });
  const trendTurningPointSchema = z.object({
    date: z.string(),
    direction: z.enum(["bullish", "bearish"]),
    level: z.enum(["info", "warning", "risk"]),
    title: z.string(),
    reason: z.string(),
    price: z.number().nullable(),
    indicatorId: z.string(),
  });
  const trendRiskSchema = z.object({
    level: z.enum(["high", "medium", "low"]),
    evidence: z.array(z.string()),
    suggestedAction: z.string(),
    reminder: z
      .object({
        direction: z.enum(["above", "below"]),
        threshold: z.number(),
        cooldownMinutes: z.number().int(),
      })
      .nullable(),
  });
  const trendReportSchema = z.object({
    id: z.string().uuid(),
    instrumentId: z.string().uuid(),
    result: z.object({
      instrument: trendInstrumentSchema,
      source: sourceSchema.nullable(),
      bars: z.array(priceBarSchema),
      indicators: z.array(
        z.object({
          indicatorId: z.string(),
          lines: z.record(z.string(), z.array(z.number().nullable())),
          signals: z.array(
            z.object({
              date: z.string(),
              direction: z.enum(["bullish", "bearish", "neutral"]),
              strength: z.number(),
              reason: z.string(),
            }),
          ),
          turningPoints: z.array(trendTurningPointSchema),
        }),
      ),
      direction: z.enum(["bullish", "bearish", "neutral"]),
      turningPoints: z.array(trendTurningPointSchema),
      risk: trendRiskSchema,
      error: z.string().nullable(),
    }),
    createdAt: z.string().datetime(),
  });
  const trendSummarySchema = z.object({
    total: z.number().int(),
    direction: z.object({
      bullish: z.number().int(),
      bearish: z.number().int(),
      neutral: z.number().int(),
    }),
    risk: z.object({
      high: z.number().int(),
      medium: z.number().int(),
      low: z.number().int(),
    }),
    turningPointCount: z.number().int(),
    riskItems: z.array(
      z.object({
        reportId: z.string().uuid(),
        instrument: trendInstrumentSchema,
        risk: trendRiskSchema,
      }),
    ),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/indicators/catalog",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Trend indicator catalog",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(trendCatalogItemSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) => context.json(success({ items: trendIndicatorCatalog }), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/strategies/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(trendStrategyInputSchema) },
      responses: {
        201: {
          description: "Created trend strategy",
          content: {
            "application/json": { schema: responseSchema(trendStrategySchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          trendStrategies.create(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/strategies/update",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          trendStrategyInputSchema.extend({ id: z.string().uuid() }),
        ),
      },
      responses: {
        200: {
          description: "Updated trend strategy",
          content: {
            "application/json": { schema: responseSchema(trendStrategySchema) },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(
          trendStrategies.update(
            context.get("currentUser").id,
            input.id,
            input,
          ),
        ),
        200,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/strategies/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Deleted trend strategy",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          trendStrategies.delete(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/strategies/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Trend strategy",
          content: {
            "application/json": { schema: responseSchema(trendStrategySchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          trendStrategies.get(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/strategies/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "User trend strategies",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(trendStrategySchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ items: trendStrategies.list(context.get("currentUser").id) }),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/strategies/targets/update",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            strategyId: z.string().uuid(),
            instrumentIds: z.array(z.string().uuid()).max(2_000),
          }),
        ),
      },
      responses: {
        200: {
          description: "Updated custom targets",
          content: {
            "application/json": { schema: responseSchema(trendStrategySchema) },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(
          trendStrategies.updateTargets(
            context.get("currentUser").id,
            input.strategyId,
            input.instrumentIds,
          ),
        ),
        200,
      );
    },
  );
  const trendTargetItemSchema = z.object({
    instrument: trendInstrumentSchema,
    currentPrice: z.number().nullable(),
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/strategies/targets/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ strategyId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Resolved targets for a trend strategy",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  targetScope: z.enum([
                    "holdings",
                    "watchlist",
                    "custom",
                    "all",
                    "holdings_watchlist",
                  ]),
                  items: z.array(trendTargetItemSchema),
                }),
              ),
            },
          },
        },
      },
    }),
    async (context) =>
      context.json(
        success(
          await trendStrategies.listTargets(
            context.get("currentUser").id,
            context.req.valid("json").strategyId,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/runs/estimate",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ strategyId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Estimated run targets",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  targetTotal: z.number().int(),
                  confirmationToken: z.string().nullable(),
                  expiresAt: z.string().datetime().nullable(),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          trendRuns.estimate(
            context.get("currentUser").id,
            context.req.valid("json").strategyId,
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/runs/start",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            strategyId: z.string().uuid(),
            confirmationToken: z.string().uuid().optional(),
          }),
        ),
      },
      responses: {
        202: {
          description: "Queued trend run",
          content: {
            "application/json": { schema: responseSchema(trendRunSchema) },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(
          trendRuns.start(
            context.get("currentUser").id,
            input.strategyId,
            input.confirmationToken,
          ),
        ),
        202,
      );
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/runs/cancel",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ runId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Cancelled trend run",
          content: {
            "application/json": { schema: responseSchema(trendRunSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          trendRuns.cancel(
            context.get("currentUser").id,
            context.req.valid("json").runId,
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/runs/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ runId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Deleted completed trend run",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          trendRuns.delete(
            context.get("currentUser").id,
            context.req.valid("json").runId,
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/runs/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ runId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Trend run",
          content: {
            "application/json": { schema: responseSchema(trendRunSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          trendRuns.get(
            context.get("currentUser").id,
            context.req.valid("json").runId,
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/runs/list",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ strategyId: z.string().uuid().optional() })),
      },
      responses: {
        200: {
          description: "Trend runs",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(trendRunSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: trendRuns.list(
            context.get("currentUser").id,
            context.req.valid("json").strategyId,
          ),
        }),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/reports/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ runId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Trend reports",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(trendReportSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: trendRuns.listReports(
            context.get("currentUser").id,
            context.req.valid("json").runId,
          ),
        }),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/runs/summary",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ runId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Trend run summary",
          content: {
            "application/json": { schema: responseSchema(trendSummarySchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          trendRuns.summarize(
            context.get("currentUser").id,
            context.req.valid("json").runId,
          ),
        ),
        200,
      ),
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/reports/interpret",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({ runId: z.string().uuid(), reportId: z.string().uuid() }),
        ),
      },
      responses: {
        200: {
          description: "Optional AI interpretation of local trend facts",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  provider: z.enum([
                    "local",
                    "deepseek",
                    "ollama",
                    "openai_compatible",
                    "opencode_go",
                  ]),
                  content: z.string(),
                  cached: z.boolean(),
                  createdAt: z.string().datetime(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (context) => {
      const userId = context.get("currentUser").id;
      const input = context.req.valid("json");
      const cached = trendRuns.getReportInterpretation(userId, input.runId, input.reportId);
      if (cached !== null) return context.json(success({ ...cached, cached: true }), 200);
      const report = trendRuns.getReport(userId, input.runId, input.reportId);
      const facts = {
        instrument: `${report.result.instrument.name} (${report.result.instrument.code})`,
        direction: report.result.direction,
        risk: report.result.risk,
        turningPoints: report.result.turningPoints.slice(-8),
        latestSignals: report.result.indicators
          .flatMap((item) => item.signals)
          .slice(0, 8),
      };
      const generated = await assistant.chat(
        userId,
        `请仅基于以下本地趋势报告事实给出风险与观察重点，不承诺收益：${JSON.stringify(facts)}`,
      );
      return context.json(success({
        ...trendRuns.saveReportInterpretation(userId, input.runId, input.reportId, generated),
        cached: false,
      }), 200);
    },
  );
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/trend/logs/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ runId: z.string().uuid() })) },
      responses: {
        200: {
          description: "Trend logs",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(
                    z.object({
                      id: z.string().uuid(),
                      level: z.enum(["info", "error"]),
                      message: z.string(),
                      createdAt: z.string().datetime(),
                    }),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: trendRuns.listLogs(
            context.get("currentUser").id,
            context.req.valid("json").runId,
          ),
        }),
        200,
      ),
  );

  const scheduleSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    kind: z.enum(["analysis", "alert-scan"]),
    strategyId: z.string().uuid().nullable(),
    intervalMinutes: z.number().int(),
    enabled: z.boolean(),
    lastRunAt: z.string().datetime().nullable(),
    nextRunAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/schedules/create",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            name: z.string().trim().min(1).max(120),
            kind: z.enum(["analysis", "alert-scan"]),
            intervalMinutes: z.number().int().min(1).max(10_080),
            strategyId: z.string().uuid().nullable(),
          }),
        ),
      },
      responses: {
        201: {
          description: "Created scheduled job",
          content: {
            "application/json": { schema: responseSchema(scheduleSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          automation.createSchedule(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/schedules/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Scheduled jobs",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(scheduleSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: automation.listSchedules(context.get("currentUser").id),
        }),
        200,
      ),
  );

  const alertDirectionSchema = z.enum(["above", "below"]);
  const alertRuleKindSchema = z.enum([
    "price_threshold",
    "target_price",
    "trade_plan",
  ]);
  const alertSourceSchema = z.enum(["manual", "system"]);
  const alertSeveritySchema = z.enum(["info", "warning", "risk"]);
  const alertScopeTypeSchema = z.enum([
    "instrument",
    "watchlist",
    "holdings",
    "custom",
  ]);
  const alertEventStatusSchema = z.enum([
    "unread",
    "read",
    "acknowledged",
    "snoozed",
    "resolved",
  ]);
  const alertSuggestionSourceSchema = z.enum([
    "trend",
    "watchlist",
    "holding",
    "system",
  ]);
  const alertSuggestionStatusSchema = z.enum([
    "pending",
    "accepted",
    "ignored",
  ]);
  const alertConditionSchema = z.union([
    z.object({
      direction: alertDirectionSchema,
      threshold: z.number().positive(),
    }),
    z.object({
      direction: alertDirectionSchema,
      targetPrice: z.number().positive(),
    }),
    z.object({
      action: z.enum(["buy", "sell", "review", "note"]),
      note: z.string().trim().min(1).max(500),
      scheduledAt: z.string().datetime(),
    }),
  ]);
  const alertRuleSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    kind: alertRuleKindSchema,
    source: alertSourceSchema,
    severity: alertSeveritySchema,
    instrumentId: z.string().uuid().nullable(),
    scopeType: alertScopeTypeSchema,
    condition: alertConditionSchema,
    direction: alertDirectionSchema.nullable(),
    threshold: z.number().nullable(),
    cooldownMinutes: z.number().int(),
    enabled: z.boolean(),
    lastTriggeredAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  const alertEventSchema = z.object({
    id: z.string().uuid(),
    alertId: z.string().uuid().nullable(),
    ruleId: z.string().uuid().nullable(),
    instrumentId: z.string().uuid().nullable(),
    severity: alertSeveritySchema,
    status: alertEventStatusSchema,
    title: z.string(),
    message: z.string(),
    price: z.number().nullable(),
    snapshot: z.record(z.string(), z.unknown()),
    triggeredAt: z.string().datetime(),
    readAt: z.string().datetime().nullable(),
    acknowledgedAt: z.string().datetime().nullable(),
    resolvedAt: z.string().datetime().nullable(),
    snoozedUntil: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  });
  const alertSuggestionSchema = z.object({
    id: z.string().uuid(),
    source: alertSuggestionSourceSchema,
    instrumentId: z.string().uuid().nullable(),
    title: z.string(),
    message: z.string(),
    severity: alertSeveritySchema,
    ruleKind: alertRuleKindSchema,
    condition: alertConditionSchema,
    cooldownMinutes: z.number().int(),
    status: alertSuggestionStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    acceptedAt: z.string().datetime().nullable(),
    ignoredAt: z.string().datetime().nullable(),
  });
  const alertSettingsSchema = z.object({
    systemMode: z.enum(["off", "suggest", "auto"]),
    defaultCooldownMinutes: z.number().int(),
    autoScanEnabled: z.boolean(),
    scanIntervalMinutes: z.number().int(),
    quietHours: z
      .object({ start: z.string(), end: z.string() })
      .nullable(),
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/create",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            instrumentId: z.string().uuid(),
            direction: alertDirectionSchema,
            threshold: z.number().positive(),
            cooldownMinutes: z.number().int().min(1).max(10_080).default(60),
          }),
        ),
      },
      responses: {
        201: {
          description: "Created alert",
          content: {
            "application/json": { schema: responseSchema(alertRuleSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          automation.createAlert(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Alert rules",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ items: z.array(alertRuleSchema) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: automation.listAlerts(context.get("currentUser").id),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/rules/create",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            name: z.string().trim().min(1).max(120),
            kind: alertRuleKindSchema,
            instrumentId: z.string().uuid().nullable().optional(),
            condition: alertConditionSchema,
            severity: alertSeveritySchema.default("warning"),
            cooldownMinutes: z.number().int().min(1).max(10_080).optional(),
            enabled: z.boolean().optional(),
            scopeType: alertScopeTypeSchema.optional(),
          }),
        ),
      },
      responses: {
        201: {
          description: "Created alert rule",
          content: {
            "application/json": { schema: responseSchema(alertRuleSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          automation.createRule(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/rules/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Generic alert rules",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ items: z.array(alertRuleSchema) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: automation.listRules(context.get("currentUser").id),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/rules/delete",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ id: z.string().uuid() })),
      },
      responses: {
        200: {
          description: "Deleted alert rule while retaining alert event history",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) => {
      automation.deleteRule(
        context.get("currentUser").id,
        context.req.valid("json").id,
      );
      return context.json(success({ deleted: true as const }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/evaluate",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Evaluated alerts",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ triggered: z.number().int() })),
            },
          },
        },
      },
    }),
    async (context) =>
      context.json(
        success({
          triggered: await automation.evaluateAlerts(
            context.get("currentUser").id,
          ),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/events/list",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            status: alertEventStatusSchema.optional(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Alert events",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(alertEventSchema),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: automation.listAlertEvents(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/events/update-status",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            id: z.string().uuid(),
            status: alertEventStatusSchema,
            snoozedUntil: z.string().datetime().nullable().optional(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Updated alert event status",
          content: {
            "application/json": { schema: responseSchema(alertEventSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          automation.updateAlertEventStatus(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/suggestions/create",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            source: alertSuggestionSourceSchema,
            instrumentId: z.string().uuid().nullable().optional(),
            title: z.string().trim().min(1).max(160),
            message: z.string().trim().min(1).max(1000),
            severity: alertSeveritySchema,
            ruleKind: alertRuleKindSchema,
            condition: alertConditionSchema,
            cooldownMinutes: z.number().int().min(1).max(10_080).optional(),
          }),
        ),
      },
      responses: {
        201: {
          description: "Created alert suggestion",
          content: {
            "application/json": { schema: responseSchema(alertSuggestionSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          automation.createSuggestion(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/suggestions/list",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            status: alertSuggestionStatusSchema.optional(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Alert suggestions",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(alertSuggestionSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: automation.listSuggestions(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/suggestions/accept",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(z.object({ id: z.string().uuid() })),
      },
      responses: {
        200: {
          description: "Accepted alert suggestion",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  suggestion: alertSuggestionSchema,
                  rule: alertRuleSchema,
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          automation.acceptSuggestion(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/settings/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Alert settings",
          content: {
            "application/json": { schema: responseSchema(alertSettingsSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(automation.getAlertSettings(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/settings/update",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            systemMode: z.enum(["off", "suggest", "auto"]).optional(),
            defaultCooldownMinutes: z.number().int().min(1).max(10_080).optional(),
            autoScanEnabled: z.boolean().optional(),
            scanIntervalMinutes: z.number().int().min(1).max(10_080).optional(),
            quietHours: z
              .object({ start: z.string(), end: z.string() })
              .nullable()
              .optional(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Updated alert settings",
          content: {
            "application/json": { schema: responseSchema(alertSettingsSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          automation.updateAlertSettings(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  const noteSchema = z.object({
    id: z.string().uuid(),
    instrumentId: z.string().uuid().nullable(),
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/notes/create",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            title: z.string().trim().min(1).max(200),
            content: z.string().max(100_000),
            tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
            instrumentId: z.string().uuid().nullable(),
          }),
        ),
      },
      responses: {
        201: {
          description: "Created note",
          content: {
            "application/json": { schema: responseSchema(noteSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          notes.create(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/notes/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "User notes",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ items: z.array(noteSchema) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({ items: notes.list(context.get("currentUser").id) }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/notes/update",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            id: z.string().uuid(),
            title: z.string().trim().min(1).max(200),
            content: z.string().max(100_000),
            tags: z.array(z.string().trim().min(1).max(40)).max(20),
            instrumentId: z.string().uuid().nullable(),
          }),
        ),
      },
      responses: {
        200: {
          description: "Updated note",
          content: {
            "application/json": { schema: responseSchema(noteSchema) },
          },
        },
      },
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(
        success(notes.update(context.get("currentUser").id, input.id, input)),
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/notes/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Deleted note",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) => {
      notes.delete(context.get("currentUser").id, context.req.valid("json").id);
      return context.json(success({ deleted: true as const }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/data/export",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Current user's business data",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  version: z.literal(1),
                  exportedAt: z.string().datetime(),
                  data: z.record(
                    z.string(),
                    z.array(
                      z.record(
                        z.string(),
                        z.union([
                          z.string(),
                          z.number(),
                          z.boolean(),
                          z.null(),
                        ]),
                      ),
                    ),
                  ),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(backup.exportUserData(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/data/import",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ data: z.unknown() })) },
      responses: {
        200: {
          description: "Replaced current user's business data",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ imported: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) => {
      backup.importUserData(
        context.get("currentUser").id,
        context.req.valid("json").data,
      );
      return context.json(success({ imported: true as const }), 200);
    },
  );

  const aiProviderSchema = z.enum([
    "local",
    "deepseek",
    "ollama",
    "openai_compatible",
    "opencode_go",
  ]);
  const aiModelInputSchema = z.object({
    id: z.string().trim().min(1).max(80),
    name: z.string().trim().max(80),
    provider: aiProviderSchema,
    baseUrl: z.string().max(500).optional(),
    model: z.string().max(200).optional(),
    apiKey: z.string().max(1_000).optional(),
    enabled: z.boolean(),
    default: z.boolean(),
  });
  const publicAiModelSchema = aiModelInputSchema
    .omit({ apiKey: true })
    .extend({ apiKeyConfigured: z.boolean() });
  const aiSystemPromptSchema = z.string().trim().min(1).max(20_000);
  const aiConfigSchema = z.object({
    models: z.array(publicAiModelSchema).min(1).max(12),
    systemPrompt: aiSystemPromptSchema,
    defaultSystemPrompt: aiSystemPromptSchema,
  });
  const aiConfigInputSchema = z.object({
    models: z.array(aiModelInputSchema).min(1).max(12),
    systemPrompt: aiSystemPromptSchema.optional(),
  });
  const openCodeGoModelSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    ownedBy: z.string(),
  });
  const openCodeGoModelListSchema = z.object({
    models: z.array(openCodeGoModelSchema),
  });
  const assistantToolEventSchema = z.object({
    id: z.string(),
    name: z.enum([
      "resolve_instrument",
      "get_account_overview",
      "get_watchlist",
      "get_market_snapshot",
      "get_market_history",
      "get_technical_indicators",
      "get_technical_ranking",
      "get_market_information_links",
      "get_market_cloud",
      "calculate_trend",
      "build_chart",
    ]),
    status: z.enum(["completed", "failed"]),
    summary: z.string(),
  });
  const assistantTrendTurningPointSchema = z.object({
    date: z.string(),
    direction: z.enum(["bullish", "bearish"]),
    level: z.enum(["info", "warning", "risk"]),
    title: z.string(),
    reason: z.string(),
    price: z.number().nullable(),
    indicatorId: z.string(),
  });
  const assistantTrendRiskSchema = z.object({
    level: z.enum(["high", "medium", "low"]),
    evidence: z.array(z.string()),
    suggestedAction: z.string(),
    reminder: z
      .object({
        direction: z.enum(["above", "below"]),
        threshold: z.number(),
        cooldownMinutes: z.number().int(),
      })
      .nullable(),
  });
  const assistantTrendSchema = z.object({
    indicators: z.array(
      z.object({
        indicatorId: z.string(),
        lines: z.record(z.string(), z.array(z.number().nullable())),
        signals: z.array(
          z.object({
            date: z.string(),
            direction: z.enum(["bullish", "bearish", "neutral"]),
            strength: z.number(),
            reason: z.string(),
          }),
        ),
        turningPoints: z.array(assistantTrendTurningPointSchema),
      }),
    ),
    turningPoints: z.array(assistantTrendTurningPointSchema),
    assessment: z.object({
      direction: z.enum(["bullish", "bearish", "neutral"]),
      turningPoints: z.array(assistantTrendTurningPointSchema),
      risk: assistantTrendRiskSchema,
    }),
  });
  const assistantChartSchema = z.object({
    id: z.string(),
    title: z.string(),
    instrument: instrumentSchema.pick({
      id: true,
      code: true,
      exchange: true,
      name: true,
      assetType: true,
    }),
    source: sourceSchema,
    bars: z.array(priceBarSchema),
    indicators: z.array(
      z.object({
        type: indicatorTypeSchema,
        lines: z.record(z.string(), z.array(z.number().nullable())),
      }),
    ),
    trend: assistantTrendSchema.optional(),
  });
  const assistantReplyMetadataSchema = z.object({
    provider: aiProviderSchema,
    modelId: z.string(),
    modelName: z.string(),
    tools: z.array(assistantToolEventSchema),
    charts: z.array(assistantChartSchema),
    fallbackReason: z.string().optional(),
  });
  const assistantConversationSummarySchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    lastMessagePreview: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  const assistantConversationMessageSchema = z.object({
    id: z.string().uuid(),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    result: assistantReplyMetadataSchema.optional(),
    createdAt: z.string().datetime(),
  });
  const assistantConversationDetailSchema =
    assistantConversationSummarySchema.extend({
      messages: z.array(assistantConversationMessageSchema),
    });
  const assistantChatSchema = assistantReplyMetadataSchema.extend({
    content: z.string(),
    conversation: assistantConversationSummarySchema,
    userMessage: assistantConversationMessageSchema,
    assistantMessage: assistantConversationMessageSchema,
  });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/ai/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Masked AI configuration",
          content: {
            "application/json": { schema: responseSchema(aiConfigSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(assistant.getConfig(context.get("currentUser").id)),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/ai/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(aiConfigInputSchema) },
      responses: {
        200: {
          description: "Updated AI configuration",
          content: {
            "application/json": { schema: responseSchema(aiConfigSchema) },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assistant.updateConfig(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/ai/opencode-go/models",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "OpenCode Go model catalog",
          content: {
            "application/json": {
              schema: responseSchema(openCodeGoModelListSchema),
            },
          },
        },
      },
    }),
    async (context) =>
      context.json(success(await assistant.listOpenCodeGoModels()), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assistant/conversations/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        201: {
          description: "Created AI conversation",
          content: {
            "application/json": {
              schema: responseSchema(assistantConversationDetailSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assistantConversations.create<AssistantReplyMetadata>(
            context.get("currentUser").id,
          ),
        ),
        201,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assistant/conversations/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Current user's recent AI conversations",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  items: z.array(assistantConversationSummarySchema),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          items: assistantConversations.list(context.get("currentUser").id),
        }),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assistant/conversations/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Current user's AI conversation",
          content: {
            "application/json": {
              schema: responseSchema(assistantConversationDetailSchema),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assistantConversations.get<AssistantReplyMetadata>(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assistant/conversations/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: {
        200: {
          description: "Deleted current user's AI conversation and messages",
          content: {
            "application/json": {
              schema: responseSchema(z.object({ deleted: z.literal(true) })),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success(
          assistantConversations.delete(
            context.get("currentUser").id,
            context.req.valid("json").id,
          ),
        ),
        200,
      ),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assistant/chat",
      middleware: [authenticated(auth)],
      request: {
        body: jsonBody(
          z.object({
            message: z.string().trim().min(1).max(10_000),
            modelId: z.string().trim().min(1).max(80).optional(),
            autoChart: z.boolean().default(true),
            conversationId: z.string().uuid().optional(),
          }),
        ),
      },
      responses: {
        200: {
          description: "AI consultation with local tool and chart results",
          content: {
            "application/json": { schema: responseSchema(assistantChatSchema) },
          },
        },
      },
    }),
    async (context) =>
      context.json(
        success(
          await assistant.chat(
            context.get("currentUser").id,
            context.req.valid("json"),
          ),
        ),
        200,
      ),
  );

  app.get("/api/analysis/trend/runs/:id/events", async (context) => {
    const token = context.req.query("token");
    if (token === undefined) throw errors.unauthenticated();
    const user = await auth.authenticate(token);
    const runId = context.req.param("id");
    return streamSSE(context, async (stream) => {
      const unsubscribe = trendRuns.subscribe(runId, (event) => {
        const data =
          event.type === "report"
            ? event.report
            : event.type === "log"
              ? event.log
              : event.run;
        void stream.writeSSE({ event: event.type, data: JSON.stringify(data) });
      });
      try {
        // Subscribe before reading the snapshot so a fast run cannot finish in
        // the gap between the initial read and listener registration.
        const run = trendRuns.get(user.id, runId);
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(run) });
        if (
          run.status === "completed" ||
          run.status === "failed" ||
          run.status === "cancelled"
        ) {
          await stream.writeSSE({
            event: run.status,
            data: JSON.stringify(run),
          });
          return;
        }
        await new Promise<void>((resolve) => stream.onAbort(resolve));
      } finally {
        unsubscribe();
      }
    });
  });

  app.get("/api/stream/tasks/:taskId", async (context) => {
    const token = context.req.query("token");
    if (token === undefined) throw errors.unauthenticated();
    const user = await auth.authenticate(token);
    const taskId = context.req.param("taskId");
    return streamSSE(context, async (stream) => {
      let task = tasks.get(user.id, taskId);
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(task) });
      while (task.status === "queued" || task.status === "running") {
        await stream.sleep(250);
        task = tasks.get(user.id, taskId);
        await stream.writeSSE({
          event: "progress",
          data: JSON.stringify(task),
        });
      }
      await stream.writeSSE({ event: task.status, data: JSON.stringify(task) });
    });
  });

  app.get("/api/stream/watchlist", async (context) => {
    const token = context.req.query("token");
    if (token === undefined) throw errors.unauthenticated();
    const user = await auth.authenticate(token);
    return streamSSE(context, async (stream) => {
      for (let iteration = 0; iteration < 120; iteration += 1) {
        const workspace = await assets.getWatchlistWorkspace(user.id, false);
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify({
            ...workspace,
            updatedAt: new Date().toISOString(),
          }),
        });
        await stream.sleep(15_000);
      }
    });
  });

  const candidateStartSchema = z.object({
    trigger: z.enum(["manual", "scheduled"]).optional(),
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    topN: z.union([z.literal(5), z.literal(10), z.literal(20)]).optional(),
    strategies: z.array(candidateStrategySchema).min(1).max(3).optional(),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/settings/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "AI candidate settings", content: { "application/json": { schema: responseSchema(candidateSettingsSchema) } } } },
    }),
    (context) => context.json(success(candidates.getSettings(context.get("currentUser").id)), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/settings/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(candidateSettingsSchema.partial()) },
      responses: { 200: { description: "Updated AI candidate settings", content: { "application/json": { schema: responseSchema(candidateSettingsSchema) } } } },
    }),
    (context) => context.json(success(candidates.updateSettings(context.get("currentUser").id, context.req.valid("json"))), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/runs/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(candidateStartSchema) },
      responses: { 202: { description: "Queued AI candidate run", content: { "application/json": { schema: responseSchema(candidateRunSchema) } } } },
    }),
    (context) => context.json(success(candidates.start(context.get("currentUser").id, context.req.valid("json")), "候选分析已排队"), 202),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/runs/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ limit: z.number().int().min(1).max(200).default(60) })) },
      responses: { 200: { description: "AI candidate runs", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(candidateRunSchema) })) } } } },
    }),
    (context) => context.json(success({ items: candidates.listRuns(context.get("currentUser").id, context.req.valid("json").limit) }), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/runs/detail",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: { 200: { description: "AI candidate run detail", content: { "application/json": { schema: responseSchema(z.unknown()) } } } },
    }),
    (context) => context.json(success(candidates.detail(context.get("currentUser").id, context.req.valid("json").id)), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/runs/cancel",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: { 200: { description: "Cancelled AI candidate run", content: { "application/json": { schema: responseSchema(candidateRunSchema) } } } },
    }),
    (context) => context.json(success(candidates.cancel(context.get("currentUser").id, context.req.valid("json").id)), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/runs/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })) },
      responses: { 200: { description: "Deleted AI candidate date record", content: { "application/json": { schema: responseSchema(z.object({ deleted: z.literal(true) })) } } } },
    }),
    (context) => context.json(success(candidates.deleteDate(context.get("currentUser").id, context.req.valid("json").tradeDate)), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/latest",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })) },
      responses: { 200: { description: "Latest AI candidate report", content: { "application/json": { schema: responseSchema(z.unknown()) } } } },
    }),
    async (context) => context.json(success(await candidates.latest(context.get("currentUser").id, context.req.valid("json").tradeDate)), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/ai-candidates/evaluations/summary",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "AI candidate evaluation summary", content: { "application/json": { schema: responseSchema(z.unknown()) } } } },
    }),
    async (context) => {
      await candidates.settle(context.get("currentUser").id);
      return context.json(success(candidates.evaluationSummary(context.get("currentUser").id)), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/admin/market/cache/clear",
      middleware: [authenticated(auth), administrator()],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "Cleared shared market cache",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ deletedBars: z.number().int() }),
              ),
            },
          },
        },
      },
    }),
    (context) => {
      const actor = context.get("currentUser");
      const deletedBars = market.clearCachedBars();
      auth.recordAudit(actor.id, "admin.market-cache-clear", { deletedBars });
      return context.json(success({ deletedBars }), 200);
    },
  );

  const auditLogSchema = z.object({
    id: z.string().uuid(),
    actorId: z.string().uuid().nullable(),
    actorEmail: z.string().email().nullable(),
    actorDisplayName: z.string().nullable(),
    action: z.string(),
    metadata: z.unknown(),
    createdAt: z.string().datetime(),
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/admin/audit-logs/list",
      middleware: [authenticated(auth), administrator()],
      request: {
        body: jsonBody(
          z.object({ limit: z.number().int().min(1).max(200).default(50) }),
        ),
      },
      responses: {
        200: {
          description: "Audit logs",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({ items: z.array(auditLogSchema) }),
              ),
            },
          },
        },
      },
    }),
    (context) => {
      const { limit } = context.req.valid("json");
      return context.json(success({ items: auth.listAuditLogs(limit) }), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/admin/system/status",
      middleware: [authenticated(auth), administrator()],
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: {
          description: "System status",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  database: z.literal("sqlite"),
                  migrationVersions: z.array(z.number().int()),
                  schedulerMode: z.literal("single-instance"),
                  time: z.string().datetime(),
                }),
              ),
            },
          },
        },
      },
    }),
    (context) =>
      context.json(
        success({
          database: "sqlite" as const,
          migrationVersions: database.getAppliedMigrationVersions(),
          schedulerMode: "single-instance" as const,
          time: new Date().toISOString(),
        }),
        200,
      ),
  );

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "IronMan API",
      version: "0.1.0",
      description: "POST body APIs for the IronMan investment workspace.",
    },
  });

  return {
    app,
    close: () => {
      scheduler.stop();
      database.close();
    },
    startScheduler: () => scheduler.start(),
  };
}
