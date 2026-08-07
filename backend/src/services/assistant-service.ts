import { errors } from "../errors";
import type { IndicatorResult, IndicatorType } from "./indicator-service";
import { IndicatorService } from "./indicator-service";
import {
  normalizeTrendIndicators,
  summarizeTrendReport,
  TrendIndicatorService,
  TREND_INDICATOR_IDS,
  type TrendIndicatorResult,
  type TrendIndicatorSelection,
  type TrendReportAssessment,
  type TrendTurningPoint,
} from "./trend-indicator-service";
import { MarketService } from "./market-service";
import { AssetsService } from "./assets-service";
import { SettingsService } from "./settings-service";
import {
  AssistantConversationService,
  type AssistantConversationMessage,
  type AssistantConversationSummary,
} from "./assistant-conversation-service";
import {
  ThirdPartyDataService,
  type ThirdPartyTechnicalKind,
  type ThirdPartyTechnicalQuery,
} from "./third-party-data-service";
import type { Instrument, MarketSource, PriceBar } from "../market/types";
import type {
  HoldingDiagnosisMethod,
  HoldingDiagnosisModelInput,
  HoldingDiagnosisModelOutput,
  HoldingDiagnosisModelSnapshot,
  HoldingDiagnosisRecommendation,
  HoldingDiagnosisTurningPoint,
} from "./holding-diagnosis-service";

export type AiProvider = "local" | "deepseek" | "ollama" | "openai_compatible";

export interface AiModelConfig {
  id: string;
  name: string;
  provider: AiProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  enabled: boolean;
  default: boolean;
}

export interface PublicAiModelConfig extends Omit<AiModelConfig, "apiKey"> {
  apiKeyConfigured: boolean;
}

export interface PublicAiConfig {
  models: PublicAiModelConfig[];
  systemPrompt: string;
  defaultSystemPrompt: string;
}

export interface AiConfigInput {
  models: AiModelConfig[];
  systemPrompt?: string;
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
  indicators: TrendIndicatorResult[];
  turningPoints: TrendTurningPoint[];
  assessment: TrendReportAssessment;
}

export interface AssistantChatInput {
  message: string;
  modelId?: string;
  autoChart?: boolean;
  conversationId?: string;
}

export interface AssistantReplyMetadata {
  provider: AiProvider;
  modelId: string;
  modelName: string;
  tools: AssistantToolEvent[];
  charts: AssistantChart[];
  fallbackReason?: string;
}

export interface AssistantChatResult extends AssistantReplyMetadata {
  content: string;
  conversation: AssistantConversationSummary;
  userMessage: AssistantConversationMessage<AssistantReplyMetadata>;
  assistantMessage: AssistantConversationMessage<AssistantReplyMetadata>;
}

interface LegacyAiConfig {
  provider: "local" | "openai";
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

const providerNames = new Set<AiProvider>([
  "local",
  "deepseek",
  "ollama",
  "openai_compatible",
]);
const modelIdPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;

export class AssistantService {
  constructor(
    private readonly settings: SettingsService,
    private readonly assets: AssetsService,
    private readonly market: MarketService,
    private readonly indicators: IndicatorService,
    private readonly trendIndicators: TrendIndicatorService,
    private readonly thirdParty: Pick<
      ThirdPartyDataService,
      "technical" | "informationLinks" | "marketCloud"
    >,
    private readonly conversations: AssistantConversationService,
  ) {}

  getConfig(userId: string): PublicAiConfig {
    return this.publicConfig(userId, this.privateModels(userId));
  }

  getHoldingDiagnosisModelSnapshot(userId: string): HoldingDiagnosisModelSnapshot {
    const model = this.selectModel(this.privateModels(userId));
    return { id: model.id, name: model.name, provider: model.provider };
  }

  updateConfig(userId: string, input: AiConfigInput): PublicAiConfig {
    if (input.models.length === 0 || input.models.length > 12) {
      throw errors.validation("请保留 1 至 12 个 AI 模型配置");
    }

    const previous = new Map(
      this.privateModels(userId).map((model) => [model.id, model]),
    );
    const ids = new Set<string>();
    const models = input.models.map((raw, index) =>
      this.normalizeModel(raw, index, previous, ids),
    );
    const enabled = models.filter((model) => model.enabled);
    if (enabled.length === 0) {
      throw errors.validation("至少启用一个 AI 模型");
    }
    const defaults = enabled.filter((model) => model.default);
    if (defaults.length > 1) {
      throw errors.validation("只能设置一个默认 AI 模型");
    }
    if (defaults.length === 0) {
      models.forEach((model) => {
        model.default = model.id === enabled[0]?.id;
      });
    }

    const systemPrompt =
      input.systemPrompt === undefined
        ? this.systemPrompt(userId)
        : normalizeSystemPrompt(input.systemPrompt);
    this.settings.upsert(userId, "ai.models", { models });
    this.settings.upsert(userId, "ai.system-prompt", { systemPrompt });
    return this.publicConfig(userId, models);
  }

  async chat(
    userId: string,
    input: string | AssistantChatInput,
  ): Promise<AssistantChatResult> {
    const request = typeof input === "string" ? { message: input } : input;
    const models = this.privateModels(userId);
    const config = this.selectModel(models, request.modelId);
    const tools: AssistantToolEvent[] = [];
    const charts: AssistantChart[] = [];
    const autoChart = request.autoChart !== false;
    const conversation =
      request.conversationId === undefined
        ? this.conversations.create(userId)
        : this.conversations.get(userId, request.conversationId);
    const context = this.conversations.getContext(userId, conversation.id, 16);
    const userMessage = this.conversations.appendUser<AssistantReplyMetadata>(
      userId,
      conversation.id,
      request.message,
    );
    let reply: AssistantReplyMetadata & { content: string };

    if (
      config.provider !== "local" &&
      config.baseUrl &&
      config.model &&
      (config.provider === "ollama" || config.apiKey)
    ) {
      try {
        const content = await this.remoteConsultation(
          userId,
          config,
          request.message,
          context,
          tools,
          charts,
        );
        await this.appendAutomaticChart(
          userId,
          request.message,
          autoChart,
          charts,
          tools,
        );
        reply = {
          provider: config.provider,
          modelId: config.id,
          modelName: config.name,
          content,
          tools,
          charts,
        };
      } catch (error) {
        const fallback = await this.localConsultation(
          userId,
          request.message,
          context,
          autoChart,
          charts,
          tools,
        );
        reply = {
          provider: "local",
          modelId: "local",
          modelName: localModel().name,
          content: fallback,
          tools,
          charts,
          fallbackReason:
            error instanceof Error ? error.message : "远程 AI 服务暂不可用",
        };
      }
    } else {
      reply = {
        provider: "local",
        modelId: "local",
        modelName: localModel().name,
        content: await this.localConsultation(
          userId,
          request.message,
          context,
          autoChart,
          charts,
          tools,
        ),
        tools,
        charts,
      };
    }

    const { content, ...metadata } = reply;
    const assistantMessage = this.conversations.appendAssistant(
      userId,
      conversation.id,
      content,
      metadata,
    );
    return {
      ...reply,
      conversation: this.conversations.getSummary(userId, conversation.id),
      userMessage,
      assistantMessage,
    };
  }

  async generateHoldingDiagnosis(input: HoldingDiagnosisModelInput): Promise<HoldingDiagnosisModelOutput> {
    if (input.items.length !== 1) {
      throw errors.validation("持仓诊断 AI 一次只能处理一个标的");
    }
    const config = this.selectModel(this.privateModels(input.userId));
    if (
      config.provider === "local" ||
      !config.baseUrl ||
      !config.model ||
      (config.provider !== "ollama" && !config.apiKey)
    ) {
      return this.localHoldingDiagnosis(input, config);
    }

    const item = input.items[0]!;
    const initialAlgorithms = await input.calculateAlgorithms(item.instrumentId, [
      { indicatorId: "MACD" },
      { indicatorId: "RSI" },
      { indicatorId: "ATR" },
    ]);
    const messages: OpenAiMessage[] = [
      {
        role: "system",
        content: [
          "你是 IronMan 的持仓诊断报告生成器。",
          "只给出条件化的决策协助，不承诺收益、不执行交易。",
          "当前请求只处理一个持仓标的，不能分析其他标的，也不能执行交易。",
          "所有价格必须来自输入、受控后端工具或本地算法结果。",
          "可按需调用后端工具补充当前标的的行情、趋势算法和图表参数。",
          "新闻、公告或公共资讯只有在工具或输入提供摘要时才能引用；仅有链接时必须说明待核验。",
          "最终必须只返回一个 JSON 对象，不得返回 Markdown、解释过程或 JSON 之外的文字。",
          "JSON 格式：{\"body\":\"不超过600字的当前标的报告正文\",\"items\":[{\"instrumentId\":\"输入中的标的ID\",\"analysis\":\"不超过180字的分析\",\"recommendation\":{\"direction\":\"add_evaluation|reduce_evaluation|hold|observe|research_further\",\"action\":\"采用操作\",\"timing\":\"不超过50字的条件和时机\",\"referencePriceLow\":null,\"referencePriceHigh\":null,\"invalidationPrice\":null,\"validUntil\":null,\"uncertainty\":\"不超过80字的风险说明\"}}]}。",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({
          reportPreference: input.reportPreference,
          holdings: [{
            instrumentId: item.instrumentId,
            name: item.name,
            code: item.code,
            quantity: item.quantity,
            averageCost: item.averageCost,
            currentPrice: item.currentPrice,
            source: item.source,
            marketError: item.marketError ?? null,
            bars: item.bars,
            localEvidence: initialAlgorithms,
            externalSources: item.externalSources.map(({ transientText, ...source }) => ({
              ...source,
              ...(source.availability === "available" || source.availability === "stale"
                ? { excerpt: transientText?.slice(0, 1_200) }
                : {}),
            })),
          }],
        }),
      },
    ];
    const methodsByInstrument = new Map<string, HoldingDiagnosisMethod[]>();
    const chartByInstrument = new Map<string, { indicators: TrendIndicatorResult[]; turningPoints: HoldingDiagnosisTurningPoint[] }>();
    methodsByInstrument.set(item.instrumentId, initialAlgorithms.methods);
    for (let attempt = 0; attempt <= input.maxFunctionBatches; attempt += 1) {
      const response = await this.requestHoldingDiagnosisCompletion(config, messages);
      const assistantMessage = response.choices?.[0]?.message;
      if (assistantMessage === undefined) throw new Error("AI 持仓诊断没有返回内容");
      const calls = assistantMessage.tool_calls ?? [];
      if (calls.length === 0) {
        const content = assistantMessage.content?.trim();
        if (!content) throw new Error("AI 持仓诊断没有返回报告");
        const output = parseHoldingDiagnosisOutput(content);
        if (output.items.length !== 1 || output.items[0]?.instrumentId !== item.instrumentId) {
          throw errors.validation("AI 持仓诊断必须只返回当前标的结果");
        }
        return {
          ...output,
          model: { id: config.id, name: config.name, provider: config.provider },
          items: output.items.map((item) => ({
            ...item,
            methods: [
              { kind: "ai_analysis", name: config.name, version: config.model, rationale: "模型基于持仓数据包与已调用算法生成诊断。" },
              ...mergeMethods(methodsByInstrument.get(item.instrumentId) ?? []),
            ],
            chart: chartByInstrument.get(item.instrumentId),
          })),
        };
      }
      if (attempt === input.maxFunctionBatches) throw new Error("AI 本地算法调用次数超过配置上限");
      if (calls.length > 12) throw new Error("AI 单批本地算法调用数量超过上限");
      messages.push({ role: "assistant", content: assistantMessage.content ?? "", tool_calls: calls });
      for (const call of calls) {
        const args = parseToolArguments(call.function?.arguments);
        const instrumentId = stringArgument(args, "instrumentId");
        if (
          instrumentId === undefined ||
          !input.items.some((item) => item.instrumentId === instrumentId)
        ) {
          throw errors.validation("AI 请求的诊断标的不在当前持仓数据包中");
        }
        const name = call.function?.name;
        let result: unknown;
        if (name === "get_holding_market_data") {
          result = input.getMarketData === undefined
            ? { source: item.source, bars: item.bars, currentPrice: item.currentPrice, error: item.marketError ?? null }
            : await input.getMarketData(instrumentId);
        } else if (name === "calculate_local_algorithms" || name === "build_holding_chart") {
          const selections = diagnosisSelections(args.selections);
          const calculation = name === "build_holding_chart" && input.buildChart !== undefined
            ? await input.buildChart(instrumentId, selections)
            : await input.calculateAlgorithms(instrumentId, selections);
          methodsByInstrument.set(instrumentId, mergeMethods([...(methodsByInstrument.get(instrumentId) ?? []), ...calculation.methods]));
          if (name === "build_holding_chart") {
            chartByInstrument.set(instrumentId, { indicators: calculation.indicators, turningPoints: calculation.turningPoints });
          }
          result = calculation;
        } else {
          throw errors.validation("AI 请求了不支持的持仓诊断工具");
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    throw new Error("AI 持仓诊断未完成");
  }

  private selectModel(
    models: AiModelConfig[],
    modelId?: string,
  ): AiModelConfig {
    if (modelId !== undefined) {
      const requested = models.find((model) => model.id === modelId);
      if (requested === undefined || !requested.enabled)
        throw errors.validation("所选 AI 模型不可用");
      return requested;
    }
    return (
      models.find((model) => model.enabled && model.default) ??
      models.find((model) => model.enabled) ??
      localModel()
    );
  }

  private async remoteConsultation(
    userId: string,
    config: AiModelConfig,
    message: string,
    context: Array<Pick<AssistantConversationMessage, "role" | "content">>,
    events: AssistantToolEvent[],
    charts: AssistantChart[],
  ): Promise<string> {
    const messages: OpenAiMessage[] = [
      { role: "system", content: this.systemPrompt(userId) },
      ...context.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: message },
    ];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.requestCompletion(config, messages);
      const assistantMessage = response.choices?.[0]?.message;
      if (assistantMessage === undefined)
        throw new Error("AI 服务没有返回可用内容");
      const calls = assistantMessage.tool_calls ?? [];
      if (calls.length === 0) {
        const content = assistantMessage.content?.trim();
        if (content) return content;
        throw new Error("AI 服务未返回咨询内容");
      }

      messages.push({
        role: "assistant",
        content: assistantMessage.content ?? "",
        tool_calls: calls,
      });
      for (const call of calls.slice(0, 6)) {
        const name = call.function?.name;
        const args = parseToolArguments(call.function?.arguments);
        const result = await this.executeTool(
          userId,
          name,
          args,
          events,
          charts,
          call.id,
        );
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }
    throw new Error("AI 工具调用次数过多，请缩小问题范围");
  }

  private async requestCompletion(
    config: AiModelConfig,
    messages: OpenAiMessage[],
    tools: readonly unknown[] = assistantTools,
    timeoutMs = 45_000,
    options: { responseFormat?: "json_object"; maxTokens?: number } = {},
  ): Promise<OpenAiResponse> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    const response = await fetch(
      `${config.baseUrl!.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: config.model,
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0.2,
          ...(options.responseFormat === undefined
            ? {}
            : { response_format: { type: options.responseFormat } }),
          ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
    return (await response.json()) as OpenAiResponse;
  }

  private async requestHoldingDiagnosisCompletion(
    config: AiModelConfig,
    messages: OpenAiMessage[],
  ): Promise<OpenAiResponse> {
    const options = config.provider === "deepseek"
      ? { responseFormat: "json_object" as const, maxTokens: 3_000 }
      : {};
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.requestCompletion(config, messages, holdingDiagnosisTools, 120_000, options);
      } catch (error) {
        lastError = error;
        if (attempt === 0 && isRetryableHoldingDiagnosisError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        if (config.provider === "deepseek" && attempt === 0 && error instanceof Error && /AI 服务返回 400/.test(error.message)) {
          return await this.requestCompletion(config, messages, holdingDiagnosisTools, 120_000, { maxTokens: 3_000 });
        }
        break;
      }
    }
    if (
      (lastError instanceof DOMException && lastError.name === "TimeoutError") ||
      (lastError instanceof Error && /timed out|timeout/i.test(lastError.message))
    ) {
      throw new Error("AI 持仓诊断请求超时（120 秒）");
    }
    throw lastError instanceof Error ? lastError : new Error("AI 持仓诊断请求失败");
  }

  private async executeTool(
    userId: string,
    rawName: string | undefined,
    args: Record<string, unknown>,
    events: AssistantToolEvent[],
    charts: AssistantChart[],
    id: string = crypto.randomUUID(),
  ): Promise<unknown> {
    if (!isAssistantToolName(rawName)) {
      events.push({
        id,
        name: "resolve_instrument",
        status: "failed",
        summary: "AI 请求了不支持的本地工具",
      });
      return { error: "不支持的本地工具" };
    }
    try {
      const result = await this.executeKnownTool(userId, rawName, args, charts);
      events.push({
        id,
        name: rawName,
        status: "completed",
        summary: toolSummary(rawName, result),
      });
      return result;
    } catch (error) {
      const summary =
        error instanceof Error ? error.message : "本地工具执行失败";
      events.push({ id, name: rawName, status: "failed", summary });
      return { error: summary };
    }
  }

  private async executeKnownTool(
    userId: string,
    name: AssistantToolName,
    args: Record<string, unknown>,
    charts: AssistantChart[],
  ): Promise<unknown> {
    switch (name) {
      case "resolve_instrument": {
        const query = stringArgument(args, "query");
        if (!query) throw errors.validation("请提供标的代码或名称");
        const assetType = assetTypeArgument(args.assetType);
        const items = await this.searchInstruments(query, assetType);
        return { items: items.slice(0, 12).map(instrumentSummary) };
      }
      case "get_account_overview": {
        const holdings = this.assets.listHoldings(userId);
        return {
          cashAvailable: holdings.cashAvailable,
          activeHoldings: holdings.items
            .filter((item) => item.status === "active")
            .map((item) => ({
              instrument: instrumentSummary(item.instrument),
              quantity: item.quantity,
              cost: item.cost,
              averageCost: item.averageCost,
            })),
          closedHoldingCount: holdings.items.filter(
            (item) => item.status === "closed",
          ).length,
        };
      }
      case "get_watchlist":
        return {
          items: this.assets
            .listWatchlist(userId)
            .map((item) => ({
              instrument: instrumentSummary(item.instrument),
              note: item.note,
              targetPrice: item.targetPrice,
            })),
        };
      case "get_market_snapshot": {
        const instrument = this.market.getInstrument(
          uuidArgument(args, "instrumentId"),
        );
        const history = await this.market.getHistory(
          userId,
          instrument.id,
          "day",
          false,
          2,
        );
        const latest = history.bars.at(-1);
        const previous = history.bars.at(-2);
        if (latest === undefined) throw errors.notFound("暂无可用行情");
        return {
          instrument: instrumentSummary(instrument),
          source: history.source,
          latest,
          change:
            previous === undefined
              ? null
              : fixed(latest.close - previous.close),
          changeRate:
            previous === undefined || previous.close === 0
              ? null
              : fixed(
                  ((latest.close - previous.close) / previous.close) * 100,
                  4,
                ),
        };
      }
      case "get_market_history": {
        const instrument = this.market.getInstrument(
          uuidArgument(args, "instrumentId"),
        );
        const history = await this.market.getHistory(
          userId,
          instrument.id,
          "day",
          false,
          limitArgument(args, 180),
        );
        return {
          instrument: instrumentSummary(instrument),
          source: history.source,
          summary: historySummary(history.bars),
          bars: history.bars.slice(-60),
        };
      }
      case "get_technical_indicators": {
        const instrument = this.market.getInstrument(
          uuidArgument(args, "instrumentId"),
        );
        const indicatorTypes = indicatorArguments(args.indicators);
        const history = await this.market.getHistory(
          userId,
          instrument.id,
          "day",
          false,
          limitArgument(args, 180),
        );
        const results = this.indicators.calculate(history.bars, indicatorTypes);
        return {
          instrument: instrumentSummary(instrument),
          source: history.source,
          summary: indicatorSummary(results),
          indicators: results,
        };
      }
      case "get_technical_ranking": {
        const kind = technicalKindArgument(args.kind);
        const query: ThirdPartyTechnicalQuery = { kind };
        const category = boundedOptionalIntegerArgument(
          args.category,
          "新高分类",
          0,
          3,
        );
        const days = boundedOptionalIntegerArgument(args.days, "天数", 1, 30);
        const date = marketDateArgument(args.date);
        if (category !== undefined) query.category = category;
        if (days !== undefined) query.days = days;
        if (date !== undefined) query.date = date;
        const ranking = await this.thirdParty.technical(userId, query);
        const limit = rankingLimitArgument(args.limit);
        return {
          kind,
          label: technicalRankingLabel(kind),
          source: ranking.source,
          updatedAt: ranking.updatedAt,
          total: ranking.rows.length,
          columns: ranking.columns,
          rows: ranking.rows
            .slice(0, limit)
            .map((row) => ({
              values: row.values,
              instrument:
                row.instrument === null
                  ? null
                  : instrumentSummary(row.instrument),
            })),
          notice: ranking.notice,
        };
      }
      case "get_market_information_links": {
        const instrumentId = optionalUuidArgument(args, "instrumentId");
        const instrument =
          instrumentId === undefined
            ? undefined
            : this.market.getInstrument(instrumentId);
        const groups = this.thirdParty
          .informationLinks()
          .map((group) => ({
            label: group.label,
            links: group.links
              .filter((link) => !link.needCode || instrument !== undefined)
              .map((link) => ({
                name: link.name,
                url:
                  instrument === undefined
                    ? link.url
                    : link.url.replace(
                        "{code}",
                        encodeURIComponent(instrument.code),
                      ),
                openInNewWindow: link.openInNewWindow,
              })),
          }))
          .filter((group) => group.links.length > 0);
        return {
          instrument:
            instrument === undefined ? null : instrumentSummary(instrument),
          groups,
        };
      }
      case "get_market_cloud":
        return this.thirdParty.marketCloud();
      case "calculate_trend": {
        const chart = await this.buildTrendChart(
          userId,
          uuidArgument(args, "instrumentId"),
          trendIndicatorArguments(args.indicators),
          limitArgument(args, 180),
        );
        addChart(charts, chart);
        return {
          chartId: chart.id,
          title: chart.title,
          instrument: instrumentSummary(chart.instrument),
          indicatorIds:
            chart.trend?.indicators.map((item) => item.indicatorId) ?? [],
          turningPointCount: chart.trend?.turningPoints.length ?? 0,
          direction: chart.trend?.assessment.direction ?? "neutral",
          risk: chart.trend?.assessment.risk,
        };
      }
      case "build_chart": {
        const chart = await this.buildChart(
          userId,
          uuidArgument(args, "instrumentId"),
          indicatorArguments(args.indicators),
          limitArgument(args, 180),
        );
        addChart(charts, chart);
        return {
          chartId: chart.id,
          title: chart.title,
          instrument: instrumentSummary(chart.instrument),
          indicatorTypes: chart.indicators.map((item) => item.type),
          barCount: chart.bars.length,
        };
      }
    }
  }

  private async appendAutomaticChart(
    userId: string,
    message: string,
    enabled: boolean,
    charts: AssistantChart[],
    events: AssistantToolEvent[],
  ): Promise<void> {
    if (!enabled || charts.length > 0 || !hasChartIntent(message)) return;
    const instrument = await this.resolvePromptInstrument(userId, message);
    if (instrument === undefined) return;
    if (hasTrendIntent(message)) {
      await this.executeTool(
        userId,
        "calculate_trend",
        {
          instrumentId: instrument.id,
          indicators: inferredTrendIndicators(message),
          limit: 180,
        },
        events,
        charts,
      );
      return;
    }
    await this.executeTool(
      userId,
      "build_chart",
      {
        instrumentId: instrument.id,
        indicators: preferredIndicators(message),
        limit: 180,
      },
      events,
      charts,
    );
  }

  private async resolvePromptInstrument(
    userId: string,
    message: string,
  ): Promise<{ id: string } | undefined> {
    const code = message.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
    if (code) {
      const found = await this.searchInstruments(code);
      if (found[0] !== undefined) return found[0];
    }
    const candidates = [
      ...this.assets.listHoldings(userId).items.map((item) => item.instrument),
      ...this.assets.listWatchlist(userId).map((item) => item.instrument),
    ];
    return candidates.find(
      (item) => message.includes(item.code) || message.includes(item.name),
    );
  }

  private async searchInstruments(
    query: string,
    assetType?: Instrument["assetType"],
  ): Promise<Instrument[]> {
    if (assetType !== undefined) return this.market.search(query, assetType);
    const local = await this.market.search(query);
    if (local.length > 0) return local;
    const results: Instrument[] = [];
    let lastError: unknown;
    for (const type of ["stock", "index", "fund"] as const) {
      try {
        const items = await this.market.search(query, type);
        for (const item of items) {
          if (!results.some((existing) => existing.id === item.id))
            results.push(item);
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (results.length > 0) return results;
    if (lastError instanceof Error) throw lastError;
    return [];
  }

  private async buildChart(
    userId: string,
    instrumentId: string,
    indicatorTypes: IndicatorType[],
    limit: number,
  ): Promise<AssistantChart> {
    const instrument = this.market.getInstrument(instrumentId);
    const history = await this.market.getHistory(
      userId,
      instrumentId,
      "day",
      false,
      limit,
    );
    return {
      id: `chart-${instrument.id}-${indicatorTypes.join("-").toLowerCase()}`,
      title: `${instrument.name} ${instrument.code} · 日线`,
      instrument: instrumentSummary(instrument),
      source: history.source,
      bars: history.bars,
      indicators: this.indicators.calculate(history.bars, indicatorTypes),
    };
  }

  private async buildTrendChart(
    userId: string,
    instrumentId: string,
    rawSelections: TrendIndicatorSelection[],
    limit: number,
  ): Promise<AssistantChart> {
    const instrument = this.market.getInstrument(instrumentId);
    const history = await this.market.getHistory(
      userId,
      instrumentId,
      "day",
      false,
      limit,
    );
    const selections = normalizeTrendIndicators(rawSelections);
    const indicators = this.trendIndicators.calculate(history.bars, selections);
    const assessment = summarizeTrendReport(history.bars, indicators);
    return {
      id: `trend-chart-${instrument.id}-${selections.map((item) => item.indicatorId.toLowerCase()).join("-")}`,
      title: `${instrument.name} ${instrument.code} · 趋势与拐点`,
      instrument: instrumentSummary(instrument),
      source: history.source,
      bars: history.bars,
      indicators: [],
      trend: {
        indicators,
        turningPoints: assessment.turningPoints,
        assessment,
      },
    };
  }

  private normalizeModel(
    raw: AiModelConfig,
    index: number,
    previous: Map<string, AiModelConfig>,
    ids: Set<string>,
  ): AiModelConfig {
    const id = raw.id.trim();
    if (!modelIdPattern.test(id) || ids.has(id)) {
      throw errors.validation("AI 模型配置 ID 无效或重复");
    }
    ids.add(id);
    if (!providerNames.has(raw.provider)) {
      throw errors.validation("不支持的 AI 服务商");
    }
    const model: AiModelConfig = {
      id,
      name: raw.name.trim() || `AI 模型 ${index + 1}`,
      provider: raw.provider,
      baseUrl: raw.baseUrl?.trim() || undefined,
      model: raw.model?.trim() || undefined,
      apiKey: raw.apiKey?.trim() || previous.get(id)?.apiKey,
      enabled: Boolean(raw.enabled),
      default: Boolean(raw.default),
    };
    if (
      model.name.length > 80 ||
      (model.baseUrl?.length ?? 0) > 500 ||
      (model.model?.length ?? 0) > 200 ||
      (model.apiKey?.length ?? 0) > 1_000
    ) {
      throw errors.validation("AI 模型配置字段过长");
    }
    if (model.provider === "local") {
      return {
        ...model,
        baseUrl: undefined,
        model: undefined,
        apiKey: undefined,
      };
    }
    if (!model.baseUrl || !model.model) {
      throw errors.validation("远程 AI 服务需要地址和模型名称");
    }
    try {
      new URL(model.baseUrl);
    } catch {
      throw errors.validation("AI 服务地址无效");
    }
    if (model.provider !== "ollama" && !model.apiKey) {
      throw errors.validation("该 AI 服务需要 API Key");
    }
    return model;
  }

  private privateModels(userId: string): AiModelConfig[] {
    const stored = this.settings.get(userId, "ai.models")?.value;
    if (isAiModelCollection(stored)) {
      return stored.models;
    }
    const legacy = this.settings.get(userId, "ai.config")?.value;
    if (isLegacyAiConfig(legacy)) {
      return [
        legacy.provider === "local"
          ? localModel()
          : {
              id: "primary",
              name: "OpenAI 兼容服务",
              provider: "openai_compatible",
              baseUrl: legacy.baseUrl,
              model: legacy.model,
              apiKey: legacy.apiKey,
              enabled: true,
              default: true,
            },
      ];
    }
    return [localModel()];
  }

  private publicConfig(
    userId: string,
    models: AiModelConfig[],
  ): PublicAiConfig {
    return {
      models: models.map(toPublicModel),
      systemPrompt: this.systemPrompt(userId),
      defaultSystemPrompt: DEFAULT_ASSISTANT_SYSTEM_PROMPT,
    };
  }

  private systemPrompt(userId: string): string {
    const stored = this.settings.get(userId, "ai.system-prompt")?.value;
    return isAiSystemPromptConfig(stored)
      ? stored.systemPrompt
      : DEFAULT_ASSISTANT_SYSTEM_PROMPT;
  }

  private async localConsultation(
    userId: string,
    message: string,
    context: Array<Pick<AssistantConversationMessage, "role" | "content">>,
    autoChart: boolean,
    charts: AssistantChart[],
    events: AssistantToolEvent[],
  ): Promise<string> {
    await this.appendAutomaticChart(userId, message, autoChart, charts, events);
    const summary = this.localSummary(userId, message, context.length);
    const externalSummary = await this.localThirdPartySummary(
      userId,
      message,
      events,
    );
    const chart = charts[0];
    const chartText =
      chart === undefined
        ? ""
        : chart.trend === undefined
          ? ` 已附上 ${chart.instrument.name} 的本地 K 线与常用指标，可继续追问均线、MACD 或风险观察位。`
          : ` 已完成 ${chart.instrument.name} 的趋势计算：整体${trendDirectionLabel(chart.trend.assessment.direction)}，识别 ${chart.trend.turningPoints.length} 个趋势拐点，风险等级为${trendRiskLabel(chart.trend.assessment.risk.level)}。图表已标记对应拐点。`;
    return `${summary}${externalSummary}${chartText}`;
  }

  private async localThirdPartySummary(
    userId: string,
    message: string,
    events: AssistantToolEvent[],
  ): Promise<string> {
    const rankingRequest = inferTechnicalRankingRequest(message);
    if (rankingRequest !== undefined) {
      const result = await this.executeTool(
        userId,
        "get_technical_ranking",
        rankingRequest,
        events,
        [],
      );
      return localRankingSummary(result);
    }
    if (/大盘云图|市场云图/.test(message)) {
      const result = await this.executeTool(
        userId,
        "get_market_cloud",
        {},
        events,
        [],
      );
      const payload = resultRecord(result);
      return typeof payload.title === "string" &&
        typeof payload.openUrl === "string"
        ? ` 已整理${payload.title}入口：${payload.openUrl}。`
        : " 大盘云图入口暂不可用。";
    }
    if (/资讯入口|外部资讯|财经资讯|市场资讯|信息入口/.test(message)) {
      const result = await this.executeTool(
        userId,
        "get_market_information_links",
        {},
        events,
        [],
      );
      const groups = resultRecord(result).groups;
      const count = Array.isArray(groups) ? groups.length : 0;
      return count > 0
        ? ` 已整理 ${count} 组外部财经与行情入口；这些链接仅供进一步查阅，不代表本地已经验证其内容。`
        : " 外部资讯入口暂不可用。";
    }
    return "";
  }

  private localSummary(
    userId: string,
    message: string,
    contextCount: number,
  ): string {
    const holdings = this.assets.listHoldings(userId);
    const watchlist = this.assets.listWatchlist(userId);
    const active = holdings.items.filter(
      (holding) => holding.status === "active",
    );
    const question = message.trim() || "当前工作台";
    const context =
      contextCount > 0
        ? ` 已承接当前会话最近 ${contextCount} 条消息的上下文。`
        : "";
    return `针对“${question}”，当前账户有 ${active.length} 个活动持仓、${watchlist.length} 个自选标的，可用资金为 ${holdings.cashAvailable.toFixed(2)}。${context}本地助手仅汇总工作台数据，请结合风险承受能力独立判断。`;
  }

  private async localHoldingDiagnosis(input: HoldingDiagnosisModelInput, config: AiModelConfig): Promise<HoldingDiagnosisModelOutput> {
    const items = await Promise.all(input.items.map(async (item) => {
      const local = await input.calculateAlgorithms(item.instrumentId, [
        { indicatorId: "MACD" },
        { indicatorId: "RSI" },
        { indicatorId: "ATR" },
      ]);
      const currentPrice = item.currentPrice;
      const recommendation: HoldingDiagnosisRecommendation = {
        direction: "observe",
        timing: "等待下一交易日价格与趋势确认",
        referencePriceLow: currentPrice,
        referencePriceHigh: currentPrice,
        invalidationPrice: null,
        validUntil: null,
        uncertainty: "当前使用本地诊断规则，未包含远程模型的补充判断。",
      };
      return {
        instrumentId: item.instrumentId,
        analysis: `${item.name} 已使用本地趋势函数完成基础诊断。`,
        recommendation,
        methods: [
          { kind: "local_function" as const, name: "本地行情与指标摘要", rationale: "使用本地持仓、行情和受控趋势函数生成基础诊断。" },
          ...local.methods,
        ],
        turningPoints: local.turningPoints,
      };
    }));
    return {
      body: `已完成 ${items.length} 个持仓的本地数据诊断。当前模型为${config.name}；请结合图表、来源与个人风险承受能力独立判断。`,
      items,
      model: { id: config.id, name: config.name, provider: config.provider },
    };
  }
}

function localModel(): AiModelConfig {
  return {
    id: "local",
    name: "本地工作台助手",
    provider: "local",
    enabled: true,
    default: true,
  };
}

function toPublicModel(model: AiModelConfig): PublicAiModelConfig {
  const { apiKey: _apiKey, ...publicModel } = model;
  return { ...publicModel, apiKeyConfigured: Boolean(model.apiKey) };
}

function isAiModelCollection(
  value: unknown,
): value is { models: AiModelConfig[] } {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { models?: unknown }).models)
  )
    return false;
  return (value as { models: unknown[] }).models.every((model) => {
    if (typeof model !== "object" || model === null) return false;
    const item = model as Partial<AiModelConfig>;
    return (
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      providerNames.has(item.provider as AiProvider) &&
      typeof item.enabled === "boolean" &&
      typeof item.default === "boolean"
    );
  });
}

function isLegacyAiConfig(value: unknown): value is LegacyAiConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Partial<LegacyAiConfig>;
  return config.provider === "local" || config.provider === "openai";
}

function isAiSystemPromptConfig(
  value: unknown,
): value is { systemPrompt: string } {
  if (typeof value !== "object" || value === null) return false;
  const systemPrompt = (value as { systemPrompt?: unknown }).systemPrompt;
  return typeof systemPrompt === "string" && systemPrompt.trim().length > 0;
}

function normalizeSystemPrompt(value: string): string {
  const systemPrompt = value.trim();
  if (!systemPrompt) throw errors.validation("系统提示词不能为空");
  if (systemPrompt.length > 20_000)
    throw errors.validation("系统提示词不能超过 20000 个字符");
  return systemPrompt;
}

interface OpenAiToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiResponse {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAiToolCall[] };
  }>;
}

export const DEFAULT_ASSISTANT_SYSTEM_PROMPT = [
  "你是 IronMan 数据分析工作台中的金融咨询助手。",
  "回答必须基于用户提问和本地工具返回的数据；没有数据时明确说明，不要编造价格、指标、新闻或收益结论。",
  "需要标的行情、K线、均线、MACD、RSI、布林带或账户数据时，必须优先调用本地工具。",
  "需要创新高、连涨、放量、量价齐升或涨停股池等市场筛选数据时，调用 get_technical_ranking，并说明结果来源及其 notice。",
  "需要外部资讯或市场网站时，只能调用 get_market_information_links 或 get_market_cloud；这些工具只提供访问入口，不能据此声称已经阅读或验证站外内容。",
  "先使用 resolve_instrument 取得精确的 instrumentId，再查询行情或创建图表。",
  "当用户要求趋势计算、趋势拐点、金叉死叉、MACD 拐点或指标图表时，调用 calculate_trend；它会返回受控的指标线、风险评估和可在本地图表标记的拐点。",
  "当用户只需要常规 K线、均线、MACD、RSI 或布林带图表时，调用 build_chart。",
  "给出可核验的观察点、风险和条件化建议，不承诺收益，也不替用户作买卖决定。",
].join("\n");

const assistantTools = [
  {
    type: "function",
    function: {
      name: "calculate_trend",
      description:
        "使用趋势计算页面同一套本地指标引擎计算日线指标、趋势风险和趋势拐点，并创建可标记拐点的图表卡片。用于 MACD 拐点、均线交叉、KDJ、RSI、布林带等趋势分析。",
      parameters: {
        type: "object",
        properties: {
          instrumentId: {
            type: "string",
            description: "标的 UUID，先用 resolve_instrument 获取",
          },
          indicators: {
            type: "array",
            description: "趋势指标和可选计算参数；未提供时默认 MACD。",
            items: {
              type: "object",
              properties: {
                indicatorId: { type: "string", enum: TREND_INDICATOR_IDS },
                parameters: {
                  type: "object",
                  additionalProperties: { type: "number" },
                },
              },
              required: ["indicatorId"],
            },
          },
          limit: { type: "integer", minimum: 30, maximum: 360 },
        },
        required: ["instrumentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_instrument",
      description:
        "按代码或名称检索股票、指数、ETF 或基金，返回后续工具需要的 instrumentId。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "标的代码或名称" },
          assetType: {
            type: "string",
            enum: ["stock", "index", "fund"],
            description: "可选标的类型",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_account_overview",
      description:
        "读取当前账户的持仓数量、成本和可用资金；仅返回当前登录用户的数据。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_watchlist",
      description: "读取当前用户的自选标的和备注。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_snapshot",
      description: "读取一个标的的最新日线快照、涨跌额和涨跌幅。",
      parameters: {
        type: "object",
        properties: { instrumentId: { type: "string" } },
        required: ["instrumentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_history",
      description: "读取一个标的的日线历史行情和区间摘要。",
      parameters: {
        type: "object",
        properties: {
          instrumentId: { type: "string" },
          limit: { type: "integer", minimum: 30, maximum: 360 },
        },
        required: ["instrumentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_technical_indicators",
      description: "基于本地日线计算 MA、MACD、RSI、BOLL 指标。",
      parameters: {
        type: "object",
        properties: {
          instrumentId: { type: "string" },
          indicators: {
            type: "array",
            items: { type: "string", enum: ["MA", "MACD", "RSI", "BOLL"] },
          },
          limit: { type: "integer", minimum: 30, maximum: 360 },
        },
        required: ["instrumentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_technical_ranking",
      description:
        "获取工程内三方数据服务提供的技术榜单。支持创新高、连续上涨、持续放量、量价齐升和涨停股池；结果优先来自 AKShare，失败时按服务策略降级。",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: [
              "new_high",
              "uptrend",
              "high_volume",
              "rise_volume_price",
              "limit_up_pool",
            ],
          },
          category: {
            type: "integer",
            minimum: 0,
            maximum: 3,
            description: "仅创新高可用：0 月，1 半年，2 一年，3 历史",
          },
          days: {
            type: "integer",
            minimum: 1,
            maximum: 30,
            description: "连续上涨、持续放量或量价齐升的最少天数",
          },
          date: {
            type: "string",
            description:
              "仅涨停股池可用，格式 YYYY-MM-DD；省略时使用服务默认最近交易日",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 30,
            description: "返回前 N 行，默认 12",
          },
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_information_links",
      description:
        "获取工程内维护的外部财经资讯、行情与个股信息入口。可选传入 instrumentId 生成该标的的专属链接；返回的是入口 URL，不包含站外内容。",
      parameters: {
        type: "object",
        properties: {
          instrumentId: {
            type: "string",
            description: "可选。标的 UUID；传入后返回个股相关入口",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_cloud",
      description:
        "获取工程内三方数据页面使用的大盘云图入口。仅返回标题和链接，不读取站外页面内容。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "build_chart",
      description:
        "创建由本地组件渲染的 K线和指标图表卡片。用户希望看图、趋势、均线或指标时调用。",
      parameters: {
        type: "object",
        properties: {
          instrumentId: { type: "string" },
          indicators: {
            type: "array",
            items: { type: "string", enum: ["MA", "MACD", "RSI", "BOLL"] },
          },
          limit: { type: "integer", minimum: 30, maximum: 360 },
        },
        required: ["instrumentId"],
      },
    },
  },
] as const;

const holdingDiagnosisTools = [
  {
    type: "function",
    function: {
      name: "get_holding_market_data",
      description: "读取当前持仓标的的本地行情快照、有限日线历史和数据状态；不能访问其他标的。",
      parameters: {
        type: "object",
        properties: { instrumentId: { type: "string", description: "报告输入中已有的标的 ID" } },
        required: ["instrumentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "calculate_local_algorithms",
      description:
        "对一个已在输入持仓列表中的标的批量调用受控本地趋势算法。仅用于补充持仓诊断的趋势、波动、形态和拐点证据；不能执行交易或访问任意代码。",
      parameters: {
        type: "object",
        properties: {
          instrumentId: {
            type: "string",
            description: "报告输入中已有的标的 ID",
          },
          selections: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                indicatorId: { type: "string", enum: TREND_INDICATOR_IDS },
                parameters: {
                  type: "object",
                  additionalProperties: { type: "number" },
                },
              },
              required: ["indicatorId"],
            },
          },
        },
        required: ["instrumentId", "selections"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "build_holding_chart",
      description: "基于当前持仓标的的本地行情和指定指标生成图表数据与拐点参数。不能执行交易。",
      parameters: {
        type: "object",
        properties: {
          instrumentId: { type: "string", description: "报告输入中已有的标的 ID" },
          selections: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                indicatorId: { type: "string", enum: TREND_INDICATOR_IDS },
                parameters: { type: "object", additionalProperties: { type: "number" } },
              },
              required: ["indicatorId"],
            },
          },
        },
        required: ["instrumentId", "selections"],
      },
    },
  },
] as const;

const assistantToolNames = new Set<AssistantToolName>([
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
]);

function isAssistantToolName(
  value: string | undefined,
): value is AssistantToolName {
  return (
    value !== undefined && assistantToolNames.has(value as AssistantToolName)
  );
}

function parseToolArguments(
  value: string | undefined,
): Record<string, unknown> {
  if (value === undefined || value.trim() === "") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringArgument(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function diagnosisSelections(value: unknown): TrendIndicatorSelection[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    throw errors.validation("请提供 1 至 12 个本地趋势算法");
  }
  const seen = new Set<string>();
  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw errors.validation("本地趋势算法参数无效");
    }
    const item = raw as { indicatorId?: unknown; parameters?: unknown };
    if (
      typeof item.indicatorId !== "string" ||
      !TREND_INDICATOR_IDS.includes(
        item.indicatorId as (typeof TREND_INDICATOR_IDS)[number],
      )
    ) {
      throw errors.validation("本地趋势算法无效");
    }
    const parameters: Record<string, number> = {};
    if (item.parameters !== undefined) {
      if (
        typeof item.parameters !== "object" ||
        item.parameters === null ||
        Array.isArray(item.parameters)
      ) {
        throw errors.validation("本地趋势算法参数无效");
      }
      for (const [key, parameter] of Object.entries(item.parameters)) {
        if (typeof parameter !== "number" || !Number.isFinite(parameter)) {
          throw errors.validation("本地趋势算法参数必须是有限数字");
        }
        parameters[key] = parameter;
      }
    }
    const signature = `${item.indicatorId}:${Object.entries(parameters)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, parameter]) => `${key}=${parameter}`)
      .join(",")}`;
    if (seen.has(signature)) throw errors.validation("本地趋势算法重复");
    seen.add(signature);
    return {
      indicatorId: item.indicatorId as TrendIndicatorSelection["indicatorId"],
      parameters,
    };
  });
}

function mergeMethods(methods: HoldingDiagnosisMethod[]): HoldingDiagnosisMethod[] {
  const seen = new Set<string>();
  return methods.filter((method) => {
    const key = `${method.kind}:${method.name}:${method.version ?? ""}:${JSON.stringify(method.parameters ?? {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRetryableHoldingDiagnosisError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : "";
  const status = /AI 服务返回\s+(\d{3})/.exec(detail)?.[1];
  if (status !== undefined) {
    const code = Number(status);
    return code === 429 || code >= 500;
  }
  return error instanceof TypeError || /fetch failed|network|ECONN|ENOTFOUND/i.test(detail);
}

function parseHoldingDiagnosisOutput(
  content: string,
): Omit<HoldingDiagnosisModelOutput, "model"> {
  const candidate = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw errors.validation("AI 持仓诊断未返回有效 JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw errors.validation("AI 持仓诊断结果格式无效");
  }
  const output = parsed as { body?: unknown; items?: unknown };
  if (
    typeof output.body !== "string" ||
    output.body.trim() === "" ||
    !Array.isArray(output.items)
  ) {
    throw errors.validation("AI 持仓诊断缺少正文或标的结果");
  }
  return {
    body: output.body.trim(),
    items: output.items.map((raw) => parseHoldingDiagnosisItem(raw)),
  };
}

function parseHoldingDiagnosisItem(
  raw: unknown,
): HoldingDiagnosisModelOutput["items"][number] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw errors.validation("AI 持仓诊断标的结果格式无效");
  }
  const item = raw as {
    instrumentId?: unknown;
    analysis?: unknown;
    recommendation?: unknown;
  };
  if (
    typeof item.instrumentId !== "string" ||
    item.instrumentId.trim() === "" ||
    typeof item.analysis !== "string" ||
    item.analysis.trim() === "" ||
    typeof item.recommendation !== "object" ||
    item.recommendation === null ||
    Array.isArray(item.recommendation)
  ) {
    throw errors.validation("AI 持仓诊断标的字段无效");
  }
  const recommendation = item.recommendation as Record<string, unknown>;
  const direction = recommendation.direction;
  const timing = recommendation.timing;
  const uncertainty = recommendation.uncertainty;
  if (
    !isHoldingDiagnosisDirection(direction) ||
    typeof timing !== "string" ||
    typeof uncertainty !== "string"
  ) {
    throw errors.validation("AI 持仓诊断建议字段无效");
  }
  return {
    instrumentId: item.instrumentId.trim(),
    analysis: item.analysis.trim().slice(0, 1_200),
    recommendation: {
      direction,
      action: typeof recommendation.action === "string"
        ? recommendation.action.trim().slice(0, 120)
        : undefined,
      timing: timing.trim().slice(0, 120),
      referencePriceLow: finiteNumberOrNull(recommendation.referencePriceLow),
      referencePriceHigh: finiteNumberOrNull(recommendation.referencePriceHigh),
      invalidationPrice: finiteNumberOrNull(recommendation.invalidationPrice),
      validUntil:
        typeof recommendation.validUntil === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(recommendation.validUntil)
          ? recommendation.validUntil
          : null,
      uncertainty: uncertainty.trim().slice(0, 300),
    },
  };
}

function isHoldingDiagnosisDirection(
  value: unknown,
): value is HoldingDiagnosisRecommendation["direction"] {
  return (
    value === "add_evaluation" ||
    value === "reduce_evaluation" ||
    value === "hold" ||
    value === "observe" ||
    value === "research_further"
  );
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function uuidArgument(args: Record<string, unknown>, key: string): string {
  const value = stringArgument(args, key);
  if (
    value === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw errors.validation("标的标识无效，请先使用标的检索工具");
  }
  return value;
}

function optionalUuidArgument(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  if (args[key] === undefined || args[key] === null || args[key] === "")
    return undefined;
  return uuidArgument(args, key);
}

function assetTypeArgument(
  value: unknown,
): Instrument["assetType"] | undefined {
  return value === "stock" || value === "index" || value === "fund"
    ? value
    : undefined;
}

function limitArgument(
  args: Record<string, unknown>,
  fallback: number,
): number {
  const value = args.limit;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(30, Math.min(360, Math.floor(value)));
}

function indicatorArguments(value: unknown): IndicatorType[] {
  const known: IndicatorType[] = ["MA", "MACD", "RSI", "BOLL"];
  const selected = Array.isArray(value)
    ? value.filter(
        (item): item is IndicatorType =>
          typeof item === "string" && known.includes(item as IndicatorType),
      )
    : [];
  return selected.length > 0 ? [...new Set(selected)] : ["MA", "MACD"];
}

function trendIndicatorArguments(value: unknown): TrendIndicatorSelection[] {
  if (!Array.isArray(value)) return [{ indicatorId: "MACD" }];
  const selections = value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return [];
    const raw = item as { indicatorId?: unknown; parameters?: unknown };
    if (
      typeof raw.indicatorId !== "string" ||
      !TREND_INDICATOR_IDS.includes(
        raw.indicatorId as (typeof TREND_INDICATOR_IDS)[number],
      )
    )
      return [];
    const parameters =
      typeof raw.parameters === "object" &&
      raw.parameters !== null &&
      !Array.isArray(raw.parameters)
        ? Object.fromEntries(
            Object.entries(raw.parameters).filter(
              ([, parameter]) =>
                typeof parameter === "number" && Number.isFinite(parameter),
            ),
          )
        : undefined;
    return [
      {
        indicatorId: raw.indicatorId as (typeof TREND_INDICATOR_IDS)[number],
        ...(parameters === undefined ? {} : { parameters }),
      },
    ];
  });
  return selections.length > 0
    ? selections.slice(0, 8)
    : [{ indicatorId: "MACD" }];
}

function technicalKindArgument(value: unknown): ThirdPartyTechnicalKind {
  if (
    value === "new_high" ||
    value === "uptrend" ||
    value === "high_volume" ||
    value === "rise_volume_price" ||
    value === "limit_up_pool"
  )
    return value;
  throw errors.validation("技术榜单类型无效");
}

function boundedOptionalIntegerArgument(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw errors.validation(`${label}应为 ${minimum} 至 ${maximum} 的整数`);
  }
  return value;
}

function marketDateArgument(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}([-/]?\d{2}){2}$/.test(value)) {
    throw errors.validation("交易日期格式应为 YYYY-MM-DD");
  }
  return value;
}

function rankingLimitArgument(value: unknown): number {
  if (value === undefined || value === null) return 12;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 30
  ) {
    throw errors.validation("榜单行数应为 1 至 30 的整数");
  }
  return value;
}

function technicalRankingLabel(kind: ThirdPartyTechnicalKind): string {
  switch (kind) {
    case "new_high":
      return "创新高";
    case "uptrend":
      return "连续上涨";
    case "high_volume":
      return "持续放量";
    case "rise_volume_price":
      return "量价齐升";
    case "limit_up_pool":
      return "涨停股池";
  }
}

function inferTechnicalRankingRequest(
  message: string,
): Record<string, unknown> | undefined {
  const date = message.match(/\d{4}[-/]?\d{2}[-/]?\d{2}/)?.[0];
  if (/涨停/.test(message))
    return { kind: "limit_up_pool", ...(date === undefined ? {} : { date }) };
  if (/创新高|新高/.test(message)) {
    const category = /历史/.test(message)
      ? 3
      : /一年/.test(message)
        ? 2
        : /半年/.test(message)
          ? 1
          : 0;
    return { kind: "new_high", category };
  }
  if (/连续上涨|连涨/.test(message))
    return { kind: "uptrend", days: requestedDays(message) };
  if (/持续放量|放量/.test(message))
    return { kind: "high_volume", days: requestedDays(message) };
  if (/量价齐升/.test(message))
    return { kind: "rise_volume_price", days: requestedDays(message) };
  return undefined;
}

function requestedDays(message: string): number {
  const value = message.match(/(?<!\d)([1-9]|[12]\d|30)\s*(?:天|日)/)?.[1];
  return value === undefined ? 1 : Number(value);
}

function resultRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function localRankingSummary(result: unknown): string {
  const payload = resultRecord(result);
  if (typeof payload.error === "string")
    return ` 外部技术榜单暂不可用：${payload.error}。`;
  const label = typeof payload.label === "string" ? payload.label : "技术榜单";
  const source =
    typeof payload.source === "string" ? payload.source : "未知来源";
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const items = rows
    .slice(0, 3)
    .map((item) => {
      const values = resultRecord(resultRecord(item).values);
      const name =
        values["名称"] ??
        values["股票简称"] ??
        values["名称/代码"] ??
        "未知标的";
      const code = values["代码"] ?? values["股票代码"];
      return code === undefined
        ? String(name)
        : `${String(name)}(${String(code)})`;
    })
    .filter((item) => item !== "未知标的");
  const preview =
    items.length > 0
      ? `前列标的：${items.join("、")}。`
      : "未返回可展示的标的。";
  const notice = typeof payload.notice === "string" ? ` ${payload.notice}` : "";
  return ` 已获取${label}，来源：${source}，共 ${Number(payload.total ?? rows.length)} 条；${preview}${notice}`;
}

function instrumentSummary(
  instrument: Pick<
    Instrument,
    "id" | "code" | "exchange" | "name" | "assetType"
  >,
): Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType"> {
  return {
    id: instrument.id,
    code: instrument.code,
    exchange: instrument.exchange,
    name: instrument.name,
    assetType: instrument.assetType,
  };
}

function historySummary(bars: PriceBar[]): {
  startDate: string | null;
  endDate: string | null;
  latestClose: number | null;
  changeRate: number | null;
  highest: number | null;
  lowest: number | null;
} {
  const first = bars[0];
  const latest = bars.at(-1);
  if (first === undefined || latest === undefined)
    return {
      startDate: null,
      endDate: null,
      latestClose: null,
      changeRate: null,
      highest: null,
      lowest: null,
    };
  return {
    startDate: first.date,
    endDate: latest.date,
    latestClose: latest.close,
    changeRate:
      first.close === 0
        ? null
        : fixed(((latest.close - first.close) / first.close) * 100, 4),
    highest: Math.max(...bars.map((item) => item.high)),
    lowest: Math.min(...bars.map((item) => item.low)),
  };
}

function indicatorSummary(
  results: IndicatorResult[],
): Record<string, Record<string, number | null>> {
  return Object.fromEntries(
    results.map((result) => [
      result.type,
      Object.fromEntries(
        Object.entries(result.lines).map(([name, values]) => [
          name,
          latestValue(values),
        ]),
      ),
    ]),
  );
}

function latestValue(values: Array<number | null>): number | null {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index] !== null && values[index] !== undefined)
      return values[index] as number;
  }
  return null;
}

function addChart(charts: AssistantChart[], chart: AssistantChart): void {
  const index = charts.findIndex((item) => item.id === chart.id);
  if (index === -1) charts.push(chart);
  else charts.splice(index, 1, chart);
}

function toolSummary(name: AssistantToolName, result: unknown): string {
  const payload =
    typeof result === "object" && result !== null
      ? (result as Record<string, unknown>)
      : {};
  switch (name) {
    case "resolve_instrument":
      return `完成标的检索，匹配 ${Array.isArray(payload.items) ? payload.items.length : 0} 个结果`;
    case "get_account_overview":
      return "已读取当前账户持仓与资金概览";
    case "get_watchlist":
      return `已读取 ${Array.isArray(payload.items) ? payload.items.length : 0} 个自选标的`;
    case "get_market_snapshot":
      return "已读取最新行情快照";
    case "get_market_history":
      return "已读取历史日线行情";
    case "get_technical_indicators":
      return "已完成本地技术指标计算";
    case "get_technical_ranking":
      return `已获取${String(payload.label ?? "外部技术榜单")}，共 ${Number(payload.total ?? 0)} 条`;
    case "get_market_information_links":
      return "已整理外部资讯与行情入口";
    case "get_market_cloud":
      return "已获取大盘云图入口";
    case "calculate_trend":
      return `已完成趋势计算，识别 ${Number(payload.turningPointCount ?? 0)} 个拐点`;
    case "build_chart":
      return "已生成 K 线与指标图表";
  }
}

function hasChartIntent(message: string): boolean {
  return /(k\s*线|kline|图表|走势|趋势|行情|均线|\bma\b|macd|rsi|boll|布林|技术分析)/i.test(
    message,
  );
}

function hasTrendIntent(message: string): boolean {
  return /(趋势|拐点|金叉|死叉|交叉|技术信号)/i.test(message);
}

function inferredTrendIndicators(message: string): TrendIndicatorSelection[] {
  const selections: TrendIndicatorSelection[] = [];
  const add = (
    indicatorId: TrendIndicatorSelection["indicatorId"],
    parameters?: Record<string, number>,
  ) => {
    if (!selections.some((item) => item.indicatorId === indicatorId))
      selections.push({
        indicatorId,
        ...(parameters === undefined ? {} : { parameters }),
      });
  };
  const maPeriod = message.match(/\bma\s*([0-9]{1,3})\b/i)?.[1];
  if (/均线|\bma\b/i.test(message))
    add(
      "MA",
      maPeriod === undefined ? undefined : { period: Number(maPeriod) },
    );
  if (/\bmacd\b/i.test(message)) add("MACD");
  if (/\brsi\b/i.test(message)) add("RSI");
  if (/\bkdj\b/i.test(message)) add("KDJ");
  if (/布林|\bboll\b/i.test(message)) add("BOLL");
  if (/\badx\b/i.test(message)) add("ADX");
  if (/\bsar\b/i.test(message)) add("SAR");
  if (/动量|\bmom\b/i.test(message)) add("MOM");
  return selections.length > 0 ? selections : [{ indicatorId: "MACD" }];
}

function preferredIndicators(message: string): IndicatorType[] {
  const types: IndicatorType[] = [];
  if (/均线|\bma\b/i.test(message)) types.push("MA");
  if (/macd/i.test(message)) types.push("MACD");
  if (/rsi/i.test(message)) types.push("RSI");
  if (/boll|布林/i.test(message)) types.push("BOLL");
  return types.length > 0 ? types : ["MA", "MACD"];
}

function fixed(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function trendDirectionLabel(
  direction: TrendReportAssessment["direction"],
): string {
  return direction === "bullish"
    ? "偏多"
    : direction === "bearish"
      ? "偏空"
      : "中性";
}

function trendRiskLabel(level: TrendReportAssessment["risk"]["level"]): string {
  return level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
}
