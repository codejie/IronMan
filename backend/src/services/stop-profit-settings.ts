export type StopLossStrategy = "fixed_percentage" | "fixed_amount" | "technical" | "atr";
export type TakeProfitStrategy = "risk_reward" | "trailing" | "atr_trailing" | "ma_trail" | "scaled";

export interface StopLossSettings {
  strategy: StopLossStrategy;
  /** 固定百分比止损（%），strategy = fixed_percentage 时生效 */
  fixedPercent: number;
  /** 固定金额止损（元），strategy = fixed_amount 时生效 */
  fixedAmount: number;
  /** 技术结构止损参考均线周期，strategy = technical 时生效 */
  maPeriod: number;
  /** 技术止损缓冲带（%），设在支撑/均线下方，strategy = technical 时生效 */
  bufferPercent: number;
  /** ATR 周期，strategy = atr 时生效 */
  atrPeriod: number;
  /** ATR 倍数 k，strategy = atr 时生效 */
  atrMultiplier: number;
}

export interface TakeProfitSettings {
  strategy: TakeProfitStrategy;
  /** 固定盈亏比 R:R，strategy = risk_reward 时生效 */
  riskRewardRatio: number;
  /** 高点回撤百分比（%），strategy = trailing 时生效 */
  trailingPercent: number;
  /** ATR 移动止盈倍数 p，strategy = atr_trailing 时生效 */
  atrPeriod: number;
  /** ATR 移动止盈倍数 p，strategy = atr_trailing 时生效 */
  atrTrailMultiplier: number;
  /** 均线跟踪周期，strategy = ma_trail 时生效 */
  maTrailPeriod: number;
  /** 阶梯止盈各阶段目标盈亏比 */
  scaleStages: Array<{ ratio: number; sellPercent: number }>;
}

export interface RiskSizingSettings {
  /** 每笔交易最大风险占账户比例（%） */
  riskPerTradePercent: number;
}

export interface StopProfitSettings {
  stopLoss: StopLossSettings;
  takeProfit: TakeProfitSettings;
  risk: RiskSizingSettings;
}
