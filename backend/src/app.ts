import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { RuntimeConfig } from "./config";
import { failure, success } from "./contracts";
import { IronManDatabase } from "./db/database";
import { AppError, errors } from "./errors";
import { AssetsService } from "./services/assets-service";
import { AssistantService } from "./services/assistant-service";
import { AnalysisTaskService } from "./services/analysis-task-service";
import { AutomationScheduler, AutomationService } from "./services/automation-service";
import { BackupService } from "./services/backup-service";
import { AuthService, type PublicUser } from "./services/auth-service";
import { IndicatorService } from "./services/indicator-service";
import { MarketService } from "./services/market-service";
import { NoteService } from "./services/note-service";
import { SettingsService } from "./services/settings-service";
import { StrategyService } from "./services/strategy-service";

type AppVariables = {
  currentUser: PublicUser;
};

const emailSchema = z.string().trim().email().max(254).openapi({ example: "investor@example.com" });
const passwordSchema = z.string().min(12).max(128).openapi({ example: "a-strong-password" });
const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(["admin", "user"]),
  status: z.enum(["active", "disabled"])
});
const sessionSchema = z.object({
  token: z.string(),
  expiresAt: z.string().datetime(),
  user: publicUserSchema
});
const emptyBodySchema = z.object({}).openapi("EmptyBody");
const assetTypeSchema = z.enum(["stock", "index", "fund"]);
const exchangeSchema = z.enum(["sh", "sz", "bj", "fund"]);
const sourceSchema = z.enum(["mock", "tencent", "eastmoney"]);
const timeframeSchema = z.enum(["day", "week", "month"]);
const indicatorTypeSchema = z.enum(["MA", "MACD", "RSI", "BOLL"]);
const instrumentSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  exchange: exchangeSchema,
  name: z.string(),
  assetType: assetTypeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

function responseSchema<T extends z.ZodType>(result: T) {
  return z.object({
    code: z.number().int(),
    message: z.string().optional(),
    result
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

function authenticated(auth: AuthService): MiddlewareHandler<{ Variables: AppVariables }> {
  return async (context, next) => {
    context.set("currentUser", await auth.authenticate(authorizationToken(context)));
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
  const market = new MarketService(database, settings);
  const assets = new AssetsService(database, market);
  const assistant = new AssistantService(settings, assets);
  const indicators = new IndicatorService();
  const strategies = new StrategyService(database, market);
  const tasks = new AnalysisTaskService(database, strategies, market, indicators);
  const automation = new AutomationService(database, market, strategies, tasks);
  const scheduler = new AutomationScheduler(automation);
  const notes = new NoteService(database, market);
  const backup = new BackupService(database);
  const app = new OpenAPIHono<{ Variables: AppVariables }>();
  const allowedOrigins = new Set((process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://localhost:5175").split(",").map((origin) => origin.trim()).filter(Boolean));

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : ""),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["POST", "GET", "OPTIONS"]
    })
  );

  app.onError((error, context) => {
    if (error instanceof AppError) {
      return context.json(failure(error.code, error.message), error.status);
    }
    console.error(error);
    return context.json(failure(10000, "服务器内部错误"), 500);
  });

  app.notFound((context) => context.json(failure(10006, "接口不存在"), 404));

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/health",
      request: { body: jsonBody(emptyBodySchema) },
      responses: {
        200: { description: "Service health", content: { "application/json": { schema: responseSchema(z.object({ status: z.literal("ok"), time: z.string().datetime() })) } } }
      }
    }),
    (context) => context.json(success({ status: "ok" as const, time: new Date().toISOString() }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/auth/register",
      request: {
        body: jsonBody(
          z.object({ email: emailSchema, password: passwordSchema, displayName: z.string().trim().min(1).max(80) })
        )
      },
      responses: { 201: { description: "Registered", content: { "application/json": { schema: responseSchema(sessionSchema) } } } }
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(success(await auth.register(input)), 201);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/indicators/calculate",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ instrumentId: z.string().uuid(), indicators: z.array(indicatorTypeSchema).min(1), refresh: z.boolean().default(false) })) },
      responses: {
        200: {
          description: "TA-Lib compatible indicator results",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  source: sourceSchema,
                  bars: z.array(z.object({ date: z.string(), open: z.number(), close: z.number(), high: z.number(), low: z.number(), volume: z.number() })),
                  results: z.array(z.object({ type: indicatorTypeSchema, lines: z.record(z.string(), z.array(z.number().nullable())) }))
                })
              )
            }
          }
        }
      }
    }),
    async (context) => {
      const input = context.req.valid("json");
      const history = await market.getHistory(context.get("currentUser").id, input.instrumentId, "day", input.refresh);
      return context.json(success({ source: history.source, bars: history.bars, results: indicators.calculate(history.bars, input.indicators) }), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/auth/login",
      request: { body: jsonBody(z.object({ email: emailSchema, password: passwordSchema })) },
      responses: { 200: { description: "Session", content: { "application/json": { schema: responseSchema(sessionSchema) } } } }
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(success(await auth.login(input.email, input.password)), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/auth/refresh",
      request: { body: jsonBody(z.object({ token: z.string().min(1) })) },
      responses: { 200: { description: "Refreshed session", content: { "application/json": { schema: responseSchema(sessionSchema) } } } }
    }),
    async (context) => {
      const { token } = context.req.valid("json");
      return context.json(success(await auth.refresh(token)), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/auth/logout",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Logged out", content: { "application/json": { schema: responseSchema(z.object({ loggedOut: z.literal(true) })) } } } }
    }),
    async (context) => {
      await auth.logout(authorizationToken(context));
      return context.json(success({ loggedOut: true as const }), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/account/me",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Current user", content: { "application/json": { schema: responseSchema(publicUserSchema) } } } }
    }),
    (context) => context.json(success(context.get("currentUser")), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/account/profile/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ displayName: z.string().trim().min(1).max(80) })) },
      responses: { 200: { description: "Updated profile", content: { "application/json": { schema: responseSchema(publicUserSchema) } } } }
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(success(auth.updateProfile(context.get("currentUser").id, input.displayName)), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/account/password/change",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ currentPassword: passwordSchema, newPassword: passwordSchema })) },
      responses: { 200: { description: "Password changed", content: { "application/json": { schema: responseSchema(z.object({ changed: z.literal(true) })) } } } }
    }),
    async (context) => {
      const input = context.req.valid("json");
      await auth.changePassword(context.get("currentUser").id, input.currentPassword, input.newPassword);
      return context.json(success({ changed: true as const }), 200);
    }
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
          content: { "application/json": { schema: responseSchema(z.object({ items: z.array(z.object({ key: z.string(), value: z.unknown(), updatedAt: z.string().datetime() })) })) } }
        }
      }
    }),
    (context) => context.json(success({ items: settings.list(context.get("currentUser").id) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/upsert",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ key: z.string().regex(/^[a-z][a-z0-9_.-]{1,79}$/), value: z.unknown() })) },
      responses: {
        200: {
          description: "Stored setting",
          content: { "application/json": { schema: responseSchema(z.object({ key: z.string(), value: z.unknown(), updatedAt: z.string().datetime() })) } }
        }
      }
    }),
    (context) => {
      const input = context.req.valid("json");
      return context.json(success(settings.upsert(context.get("currentUser").id, input.key, input.value)), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/admin/users/list",
      middleware: [authenticated(auth), administrator()],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Users", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(publicUserSchema) })) } } } }
    }),
    (context) => context.json(success({ items: auth.listUsers() }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/admin/users/status",
      middleware: [authenticated(auth), administrator()],
      request: { body: jsonBody(z.object({ userId: z.string().uuid(), status: z.enum(["active", "disabled"]) })) },
      responses: { 200: { description: "User status updated", content: { "application/json": { schema: responseSchema(z.object({ updated: z.literal(true) })) } } } }
    }),
    (context) => {
      const input = context.req.valid("json");
      auth.updateUserStatus(context.get("currentUser").id, input.userId, input.status);
      return context.json(success({ updated: true as const }), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/instruments/upsert",
      middleware: [authenticated(auth), administrator()],
      request: { body: jsonBody(z.object({ code: z.string().trim().min(1).max(24), exchange: exchangeSchema, name: z.string().trim().min(1).max(120), assetType: assetTypeSchema })) },
      responses: { 200: { description: "Stored instrument", content: { "application/json": { schema: responseSchema(instrumentSchema) } } } }
    }),
    (context) => context.json(success(market.upsertInstrument(context.req.valid("json"))), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/instruments/search",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ query: z.string().trim().min(1).max(120) })) },
      responses: { 200: { description: "Matching instruments", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(instrumentSchema) })) } } } }
    }),
    (context) => context.json(success({ items: market.search(context.req.valid("json").query) }), 200)
  );

  const tradingCalendarSchema = z.object({ nonTradingDays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366) });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/trading-calendar/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "User trading calendar", content: { "application/json": { schema: responseSchema(tradingCalendarSchema) } } } }
    }),
    (context) => {
      const stored = settings.get(context.get("currentUser").id, "market.trading-calendar")?.value;
      const nonTradingDays = isTradingCalendar(stored) ? stored.nonTradingDays : [];
      return context.json(success({ nonTradingDays }), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/trading-calendar/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(tradingCalendarSchema) },
      responses: { 200: { description: "Updated trading calendar", content: { "application/json": { schema: responseSchema(tradingCalendarSchema) } } } }
    }),
    (context) => {
      const input = context.req.valid("json");
      const nonTradingDays = [...new Set(input.nonTradingDays)].sort();
      settings.upsert(context.get("currentUser").id, "market.trading-calendar", { nonTradingDays });
      return context.json(success({ nonTradingDays }), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/data-sources/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "User data source config", content: { "application/json": { schema: responseSchema(z.object({ primary: sourceSchema, fallback: sourceSchema })) } } } }
    }),
    (context) => context.json(success(market.getDataSourceConfig(context.get("currentUser").id)), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/data-sources/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ primary: sourceSchema, fallback: sourceSchema })) },
      responses: { 200: { description: "Updated data source config", content: { "application/json": { schema: responseSchema(z.object({ primary: sourceSchema, fallback: sourceSchema })) } } } }
    }),
    (context) => context.json(success(market.setDataSourceConfig(context.get("currentUser").id, context.req.valid("json"))), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/history",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ instrumentId: z.string().uuid(), timeframe: timeframeSchema.default("day"), refresh: z.boolean().default(false) })) },
      responses: {
        200: {
          description: "Historical OHLCV data",
          content: {
            "application/json": {
              schema: responseSchema(
                z.object({
                  source: sourceSchema,
                  bars: z.array(z.object({ date: z.string(), open: z.number(), close: z.number(), high: z.number(), low: z.number(), volume: z.number() }))
                })
              )
            }
          }
        }
      }
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(success(await market.getHistory(context.get("currentUser").id, input.instrumentId, input.timeframe, input.refresh)), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/overview",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Market cache overview", content: { "application/json": { schema: responseSchema(z.object({ instrumentCount: z.number().int(), cachedBarCount: z.number().int(), latestCacheAt: z.string().datetime().nullable() })) } } } }
    }),
    (context) => context.json(success(market.overview()), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/signals",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Watchlist technical signals", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(z.object({ instrumentId: z.string().uuid(), name: z.string(), code: z.string(), price: z.number(), signals: z.array(z.string()), source: sourceSchema })) })) } } } }
    }),
    async (context) => context.json(success({ items: await market.signalsForWatchlist(context.get("currentUser").id) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/market/info-links",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Curated public market links", content: { "application/json": { schema: responseSchema(z.object({ groups: z.array(z.object({ label: z.string(), links: z.array(z.object({ name: z.string(), url: z.string().url() })) })) })) } } } }
    }),
    (context) => context.json(success({ groups: market.informationLinks() }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/watchlist/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ instrumentId: z.string().uuid(), note: z.string().max(500).default(""), targetPrice: z.number().positive().nullable().optional() })) },
      responses: { 201: { description: "Created watchlist entry", content: { "application/json": { schema: responseSchema(z.object({ id: z.string().uuid(), note: z.string(), targetPrice: z.number().nullable(), sortOrder: z.number().int(), instrument: instrumentSchema.pick({ id: true, code: true, exchange: true, name: true, assetType: true }) })) } } } }
    }),
    (context) => context.json(success(assets.createWatchlistEntry(context.get("currentUser").id, context.req.valid("json"))), 201)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/watchlist/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Current user's watchlist", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(z.unknown()) })) } } } }
    }),
    (context) => context.json(success({ items: assets.listWatchlist(context.get("currentUser").id) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/watchlist/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: { 200: { description: "Deleted watchlist entry", content: { "application/json": { schema: responseSchema(z.object({ deleted: z.literal(true) })) } } } }
    }),
    (context) => {
      assets.deleteWatchlistEntry(context.get("currentUser").id, context.req.valid("json").id);
      return context.json(success({ deleted: true as const }), 200);
    }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/cash/adjust",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ amount: z.number().finite(), note: z.string().max(500).default("") })) },
      responses: { 200: { description: "Adjusted cash", content: { "application/json": { schema: responseSchema(z.object({ available: z.number() })) } } } }
    }),
    (context) => context.json(success({ available: assets.adjustCash(context.get("currentUser").id, context.req.valid("json").amount, context.req.valid("json").note) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/cash/summary",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Available cash", content: { "application/json": { schema: responseSchema(z.object({ available: z.number() })) } } } }
    }),
    (context) => context.json(success({ available: assets.getCash(context.get("currentUser").id) }), 200)
  );

  const holdingInputSchema = z.object({
    instrumentId: z.string().uuid(),
    quantity: z.number().positive(),
    price: z.number().nonnegative(),
    fee: z.number().nonnegative().default(0),
    occurredAt: z.string().datetime(),
    note: z.string().max(500).optional()
  });
  const holdingSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(["active", "closed"]),
    quantity: z.number(),
    averageCost: z.number(),
    instrument: instrumentSchema.pick({ id: true, code: true, exchange: true, name: true, assetType: true }),
    updatedAt: z.string().datetime()
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(holdingInputSchema) },
      responses: { 201: { description: "Created holding", content: { "application/json": { schema: responseSchema(holdingSchema) } } } }
    }),
    (context) => context.json(success(assets.createHolding(context.get("currentUser").id, context.req.valid("json"))), 201)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/transaction",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ holdingId: z.string().uuid(), action: z.enum(["buy", "sell", "dividend"]), quantity: z.number().nonnegative(), price: z.number().nonnegative(), fee: z.number().nonnegative().default(0), occurredAt: z.string().datetime(), note: z.string().max(500).optional() })) },
      responses: { 201: { description: "Recorded transaction", content: { "application/json": { schema: responseSchema(z.object({ id: z.string().uuid() })) } } } }
    }),
    (context) => context.json(success(assets.recordHoldingTransaction(context.get("currentUser").id, context.req.valid("json"))), 201)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Holdings and cash", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(holdingSchema), cashAvailable: z.number() })) } } } }
    }),
    (context) => context.json(success(assets.listHoldings(context.get("currentUser").id)), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assets/holdings/detail",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: { 200: { description: "Holding detail", content: { "application/json": { schema: responseSchema(z.object({ holding: holdingSchema, transactions: z.array(z.unknown()) })) } } } }
    }),
    (context) => context.json(success(assets.getHoldingDetail(context.get("currentUser").id, context.req.valid("json").id)), 200)
  );

  const strategySchema = z.object({ id: z.string().uuid(), name: z.string(), instrumentIds: z.array(z.string().uuid()), indicators: z.array(indicatorTypeSchema), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
  const taskSchema = z.object({ id: z.string().uuid(), strategyId: z.string().uuid(), status: z.enum(["queued", "running", "completed", "failed", "cancelled"]), progress: z.number().int(), errorMessage: z.string().nullable(), createdAt: z.string().datetime(), startedAt: z.string().datetime().nullable(), completedAt: z.string().datetime().nullable() });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/strategies/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ name: z.string().trim().min(1).max(120), instrumentIds: z.array(z.string().uuid()).min(1).max(100), indicators: z.array(indicatorTypeSchema).min(1).max(20) })) },
      responses: { 201: { description: "Created strategy", content: { "application/json": { schema: responseSchema(strategySchema) } } } }
    }),
    (context) => context.json(success(strategies.create(context.get("currentUser").id, context.req.valid("json"))), 201)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/strategies/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "User strategies", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(strategySchema) })) } } } }
    }),
    (context) => context.json(success({ items: strategies.list(context.get("currentUser").id) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/tasks/start",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ strategyId: z.string().uuid() })) },
      responses: { 202: { description: "Queued analysis task", content: { "application/json": { schema: responseSchema(taskSchema) } } } }
    }),
    (context) => context.json(success(tasks.start(context.get("currentUser").id, context.req.valid("json").strategyId)), 202)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/tasks/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "User analysis tasks", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(taskSchema) })) } } } }
    }),
    (context) => context.json(success({ items: tasks.list(context.get("currentUser").id) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/tasks/retry",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ taskId: z.string().uuid() })) },
      responses: { 202: { description: "Retried analysis task", content: { "application/json": { schema: responseSchema(taskSchema) } } } }
    }),
    (context) => context.json(success(tasks.retry(context.get("currentUser").id, context.req.valid("json").taskId)), 202)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/tasks/logs/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ taskId: z.string().uuid() })) },
      responses: { 200: { description: "Task logs", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(z.object({ id: z.string().uuid(), level: z.enum(["info", "error"]), message: z.string(), createdAt: z.string().datetime() })) })) } } } }
    }),
    (context) => context.json(success({ items: tasks.listLogs(context.get("currentUser").id, context.req.valid("json").taskId) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/analysis/reports/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ taskId: z.string().uuid() })) },
      responses: { 200: { description: "Task reports", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(z.object({ id: z.string().uuid(), instrumentId: z.string().uuid(), result: z.unknown(), createdAt: z.string().datetime() })) })) } } } }
    }),
    (context) => context.json(success({ items: tasks.listReports(context.get("currentUser").id, context.req.valid("json").taskId) }), 200)
  );

  const scheduleSchema = z.object({ id: z.string().uuid(), name: z.string(), kind: z.enum(["analysis", "alert-scan"]), strategyId: z.string().uuid().nullable(), intervalMinutes: z.number().int(), enabled: z.boolean(), lastRunAt: z.string().datetime().nullable(), nextRunAt: z.string().datetime(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/schedules/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(["analysis", "alert-scan"]), intervalMinutes: z.number().int().min(1).max(10_080), strategyId: z.string().uuid().nullable() })) },
      responses: { 201: { description: "Created scheduled job", content: { "application/json": { schema: responseSchema(scheduleSchema) } } } }
    }),
    (context) => context.json(success(automation.createSchedule(context.get("currentUser").id, context.req.valid("json"))), 201)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/schedules/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Scheduled jobs", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(scheduleSchema) })) } } } }
    }),
    (context) => context.json(success({ items: automation.listSchedules(context.get("currentUser").id) }), 200)
  );

  const alertSchema = z.object({ id: z.string().uuid(), instrumentId: z.string().uuid(), direction: z.enum(["above", "below"]), threshold: z.number(), cooldownMinutes: z.number().int(), enabled: z.boolean(), lastTriggeredAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ instrumentId: z.string().uuid(), direction: z.enum(["above", "below"]), threshold: z.number().positive(), cooldownMinutes: z.number().int().min(1).max(10_080).default(60) })) },
      responses: { 201: { description: "Created alert", content: { "application/json": { schema: responseSchema(alertSchema) } } } }
    }),
    (context) => context.json(success(automation.createAlert(context.get("currentUser").id, context.req.valid("json"))), 201)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Alert rules", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(alertSchema) })) } } } }
    }),
    (context) => context.json(success({ items: automation.listAlerts(context.get("currentUser").id) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/evaluate",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Evaluated alerts", content: { "application/json": { schema: responseSchema(z.object({ triggered: z.number().int() })) } } } }
    }),
    async (context) => context.json(success({ triggered: await automation.evaluateAlerts(context.get("currentUser").id) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/automation/alerts/events/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Alert events", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(z.object({ id: z.string().uuid(), alertId: z.string().uuid(), price: z.number(), message: z.string(), createdAt: z.string().datetime() })) })) } } } }
    }),
    (context) => context.json(success({ items: automation.listAlertEvents(context.get("currentUser").id) }), 200)
  );

  const noteSchema = z.object({ id: z.string().uuid(), instrumentId: z.string().uuid().nullable(), title: z.string(), content: z.string(), tags: z.array(z.string()), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/notes/create",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(100_000), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]), instrumentId: z.string().uuid().nullable() })) },
      responses: { 201: { description: "Created note", content: { "application/json": { schema: responseSchema(noteSchema) } } } }
    }),
    (context) => context.json(success(notes.create(context.get("currentUser").id, context.req.valid("json"))), 201)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/notes/list",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "User notes", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(noteSchema) })) } } } }
    }),
    (context) => context.json(success({ items: notes.list(context.get("currentUser").id) }), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/notes/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(200), content: z.string().max(100_000), tags: z.array(z.string().trim().min(1).max(40)).max(20), instrumentId: z.string().uuid().nullable() })) },
      responses: { 200: { description: "Updated note", content: { "application/json": { schema: responseSchema(noteSchema) } } } }
    }),
    (context) => { const input = context.req.valid("json"); return context.json(success(notes.update(context.get("currentUser").id, input.id, input)), 200); }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/notes/delete",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ id: z.string().uuid() })) },
      responses: { 200: { description: "Deleted note", content: { "application/json": { schema: responseSchema(z.object({ deleted: z.literal(true) })) } } } }
    }),
    (context) => { notes.delete(context.get("currentUser").id, context.req.valid("json").id); return context.json(success({ deleted: true as const }), 200); }
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/data/export",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Current user's business data", content: { "application/json": { schema: responseSchema(z.object({ version: z.literal(1), exportedAt: z.string().datetime(), data: z.record(z.string(), z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))) })) } } } }
    }),
    (context) => context.json(success(backup.exportUserData(context.get("currentUser").id)), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/data/import",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ data: z.unknown() })) },
      responses: { 200: { description: "Replaced current user's business data", content: { "application/json": { schema: responseSchema(z.object({ imported: z.literal(true) })) } } } }
    }),
    (context) => { backup.importUserData(context.get("currentUser").id, context.req.valid("json").data); return context.json(success({ imported: true as const }), 200); }
  );

  const aiConfigSchema = z.object({ provider: z.enum(["local", "openai"]), baseUrl: z.string().url().optional(), model: z.string().max(200).optional(), apiKeyConfigured: z.boolean() });
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/ai/get",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(emptyBodySchema) },
      responses: { 200: { description: "Masked AI configuration", content: { "application/json": { schema: responseSchema(aiConfigSchema) } } } }
    }),
    (context) => context.json(success(assistant.getConfig(context.get("currentUser").id)), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/settings/ai/update",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ provider: z.enum(["local", "openai"]), baseUrl: z.string().url().optional(), model: z.string().max(200).optional(), apiKey: z.string().max(1_000).optional() })) },
      responses: { 200: { description: "Updated AI configuration", content: { "application/json": { schema: responseSchema(aiConfigSchema) } } } }
    }),
    (context) => context.json(success(assistant.updateConfig(context.get("currentUser").id, context.req.valid("json"))), 200)
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/assistant/chat",
      middleware: [authenticated(auth)],
      request: { body: jsonBody(z.object({ message: z.string().trim().min(1).max(10_000) })) },
      responses: { 200: { description: "AI consultation", content: { "application/json": { schema: responseSchema(z.object({ provider: z.enum(["local", "openai"]), content: z.string() })) } } } }
    }),
    async (context) => context.json(success(await assistant.chat(context.get("currentUser").id, context.req.valid("json").message)), 200)
  );

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
        await stream.writeSSE({ event: "progress", data: JSON.stringify(task) });
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
        const items = await market.watchlistSnapshot(user.id);
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ items, updatedAt: new Date().toISOString() }) });
        await stream.sleep(15_000);
      }
    });
  });

  const auditLogSchema = z.object({
    id: z.string().uuid(),
    actorId: z.string().uuid().nullable(),
    actorEmail: z.string().email().nullable(),
    actorDisplayName: z.string().nullable(),
    action: z.string(),
    metadata: z.unknown(),
    createdAt: z.string().datetime()
  });

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/admin/audit-logs/list",
      middleware: [authenticated(auth), administrator()],
      request: { body: jsonBody(z.object({ limit: z.number().int().min(1).max(200).default(50) })) },
      responses: { 200: { description: "Audit logs", content: { "application/json": { schema: responseSchema(z.object({ items: z.array(auditLogSchema) })) } } } }
    }),
    (context) => {
      const { limit } = context.req.valid("json");
      return context.json(success({ items: auth.listAuditLogs(limit) }), 200);
    }
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
                  time: z.string().datetime()
                })
              )
            }
          }
        }
      }
    }),
    (context) =>
      context.json(
        success({
          database: "sqlite" as const,
          migrationVersions: database.getAppliedMigrationVersions(),
          schedulerMode: "single-instance" as const,
          time: new Date().toISOString()
        }),
        200
      )
  );

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "IronMan API", version: "0.1.0", description: "POST body APIs for the IronMan investment workspace." }
  });

  return { app, close: () => { scheduler.stop(); database.close(); }, startScheduler: () => scheduler.start() };
}

function isTradingCalendar(value: unknown): value is { nonTradingDays: string[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { nonTradingDays?: unknown }).nonTradingDays) && (value as { nonTradingDays: unknown[] }).nonTradingDays.every((day) => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day));
}
