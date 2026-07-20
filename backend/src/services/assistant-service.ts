import { errors } from "../errors";
import { AssetsService } from "./assets-service";
import { SettingsService } from "./settings-service";

export interface AiConfig {
  provider: "local" | "openai";
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface PublicAiConfig {
  provider: "local" | "openai";
  baseUrl?: string;
  model?: string;
  apiKeyConfigured: boolean;
}

export class AssistantService {
  constructor(
    private readonly settings: SettingsService,
    private readonly assets: AssetsService
  ) {}

  getConfig(userId: string): PublicAiConfig {
    const config = this.privateConfig(userId);
    return { provider: config.provider, baseUrl: config.baseUrl, model: config.model, apiKeyConfigured: Boolean(config.apiKey) };
  }

  updateConfig(userId: string, input: AiConfig): PublicAiConfig {
    if (input.provider === "openai" && (!input.baseUrl || !input.model)) throw errors.validation("OpenAI 兼容服务需要地址和模型名称");
    const previous = this.privateConfig(userId);
    const config: AiConfig = {
      provider: input.provider,
      baseUrl: input.baseUrl?.trim(),
      model: input.model?.trim(),
      apiKey: input.apiKey?.trim() || previous.apiKey
    };
    if (input.provider === "local") config.apiKey = undefined;
    this.settings.upsert(userId, "ai.config", config);
    return this.getConfig(userId);
  }

  async chat(userId: string, message: string): Promise<{ provider: "local" | "openai"; content: string }> {
    const config = this.privateConfig(userId);
    if (config.provider === "openai" && config.baseUrl && config.model && config.apiKey) {
      try {
        const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: "你是 IronMan 投资工作台助手。仅基于用户提供或本地工作台上下文回答，不承诺投资收益。" }, { role: "user", content: message }] }),
          signal: AbortSignal.timeout(30_000)
        });
        if (!response.ok) throw new Error(`AI 服务返回 ${response.status}`);
        const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (content) return { provider: "openai", content };
      } catch {
        // An unavailable optional provider must not block access to the local workspace summary.
      }
    }
    return { provider: "local", content: this.localSummary(userId, message) };
  }

  private privateConfig(userId: string): AiConfig {
    const value = this.settings.get(userId, "ai.config")?.value;
    if (!isAiConfig(value)) return { provider: "local" };
    return value;
  }

  private localSummary(userId: string, message: string): string {
    const holdings = this.assets.listHoldings(userId);
    const watchlist = this.assets.listWatchlist(userId);
    const active = holdings.items.filter((holding) => holding.status === "active");
    const question = message.trim() || "当前工作台";
    return `针对“${question}”，当前账户有 ${active.length} 个活动持仓、${watchlist.length} 个自选标的，可用资金为 ${holdings.cashAvailable.toFixed(2)}。本地助手仅汇总工作台数据，请结合风险承受能力独立判断。`;
  }
}

function isAiConfig(value: unknown): value is AiConfig {
  if (typeof value !== "object" || value === null) return false;
  const config = value as Partial<AiConfig>;
  return config.provider === "local" || config.provider === "openai";
}
