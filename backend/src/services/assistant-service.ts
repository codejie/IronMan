import { errors } from "../errors";
import { AssetsService } from "./assets-service";
import { SettingsService } from "./settings-service";

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
}

export interface AiConfigInput {
  models: AiModelConfig[];
}

interface LegacyAiConfig {
  provider: "local" | "openai";
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

const providerNames = new Set<AiProvider>(["local", "deepseek", "ollama", "openai_compatible"]);
const modelIdPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;

export class AssistantService {
  constructor(
    private readonly settings: SettingsService,
    private readonly assets: AssetsService
  ) {}

  getConfig(userId: string): PublicAiConfig {
    return { models: this.privateModels(userId).map(toPublicModel) };
  }

  updateConfig(userId: string, input: AiConfigInput): PublicAiConfig {
    if (input.models.length === 0 || input.models.length > 12) {
      throw errors.validation("请保留 1 至 12 个 AI 模型配置");
    }

    const previous = new Map(this.privateModels(userId).map((model) => [model.id, model]));
    const ids = new Set<string>();
    const models = input.models.map((raw, index) => this.normalizeModel(raw, index, previous, ids));
    const enabled = models.filter((model) => model.enabled);
    if (enabled.length === 0) {
      throw errors.validation("至少启用一个 AI 模型");
    }
    const defaults = enabled.filter((model) => model.default);
    if (defaults.length > 1) {
      throw errors.validation("只能设置一个默认 AI 模型");
    }
    if (defaults.length === 0) {
      models.forEach((model) => { model.default = model.id === enabled[0]?.id; });
    }

    this.settings.upsert(userId, "ai.models", { models });
    return { models: models.map(toPublicModel) };
  }

  async chat(userId: string, message: string): Promise<{ provider: AiProvider; content: string }> {
    const config = this.privateModels(userId).find((model) => model.enabled && model.default)
      ?? this.privateModels(userId).find((model) => model.enabled)
      ?? localModel();
    if (config.provider !== "local" && config.baseUrl && config.model && (config.provider === "ollama" || config.apiKey)) {
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
        const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: "system", content: "你是 IronMan 投资工作台助手。仅基于用户提供或本地工作台上下文回答，不承诺投资收益。" },
              { role: "user", content: message }
            ]
          }),
          signal: AbortSignal.timeout(30_000)
        });
        if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
        const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (content) return { provider: config.provider, content };
      } catch {
        // An unavailable optional provider must not block access to the local workspace summary.
      }
    }
    return { provider: "local", content: this.localSummary(userId, message) };
  }

  private normalizeModel(
    raw: AiModelConfig,
    index: number,
    previous: Map<string, AiModelConfig>,
    ids: Set<string>
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
      default: Boolean(raw.default)
    };
    if (model.name.length > 80 || (model.baseUrl?.length ?? 0) > 500 || (model.model?.length ?? 0) > 200 || (model.apiKey?.length ?? 0) > 1_000) {
      throw errors.validation("AI 模型配置字段过长");
    }
    if (model.provider === "local") {
      return { ...model, baseUrl: undefined, model: undefined, apiKey: undefined };
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
              default: true
            }
      ];
    }
    return [localModel()];
  }

  private localSummary(userId: string, message: string): string {
    const holdings = this.assets.listHoldings(userId);
    const watchlist = this.assets.listWatchlist(userId);
    const active = holdings.items.filter((holding) => holding.status === "active");
    const question = message.trim() || "当前工作台";
    return `针对“${question}”，当前账户有 ${active.length} 个活动持仓、${watchlist.length} 个自选标的，可用资金为 ${holdings.cashAvailable.toFixed(2)}。本地助手仅汇总工作台数据，请结合风险承受能力独立判断。`;
  }
}

function localModel(): AiModelConfig {
  return { id: "local", name: "本地工作台助手", provider: "local", enabled: true, default: true };
}

function toPublicModel(model: AiModelConfig): PublicAiModelConfig {
  const { apiKey: _apiKey, ...publicModel } = model;
  return { ...publicModel, apiKeyConfigured: Boolean(model.apiKey) };
}

function isAiModelCollection(value: unknown): value is { models: AiModelConfig[] } {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { models?: unknown }).models)) return false;
  return (value as { models: unknown[] }).models.every((model) => {
    if (typeof model !== "object" || model === null) return false;
    const item = model as Partial<AiModelConfig>;
    return typeof item.id === "string" && typeof item.name === "string" && providerNames.has(item.provider as AiProvider)
      && typeof item.enabled === "boolean" && typeof item.default === "boolean";
  });
}

function isLegacyAiConfig(value: unknown): value is LegacyAiConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Partial<LegacyAiConfig>;
  return config.provider === "local" || config.provider === "openai";
}
