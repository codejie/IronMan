import type { KlineAnnotation } from "./kline-analysis";
import type { HoldingOperation } from "@/api/client";

/** 后端 /api/assets/holdings/operations 返回的操作记录（跨该标的全部持仓）。 */
export type HoldingOperationWithHolding = HoldingOperation & {
  holdingId: string;
};

export interface KlineOperationMarker {
  /** 操作发生日期（YYYY-MM-DD） */
  date: string;
  operation: HoldingOperationWithHolding;
}

const BUY_COLOR = "#fa7575";
const SELL_COLOR = "#68d991";
const INTEREST_COLOR = "#ffbd4b";

export function operationLabel(operation: HoldingOperationWithHolding): string {
  const actionLabel =
    operation.action === "buy" ? "买入" : operation.action === "sell" ? "卖出" : "计息";
  const quantity =
    operation.action === "sell" ? Math.abs(operation.quantity) : operation.quantity;
  return `${actionLabel} ${quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

export function operationDetailLabel(
  operation: HoldingOperationWithHolding
): string {
  const parts = [
    `价格 ${operation.price}`,
    operation.fee > 0 ? `费用 ${operation.fee}` : "",
    operation.occurredAt ? `时间 ${operation.occurredAt.slice(0, 10)}` : "",
    operation.note ? `备注 ${operation.note}` : ""
  ];
  return parts.filter(Boolean).join(" · ");
}

export function operationColor(operation: HoldingOperationWithHolding): string {
  if (operation.action === "buy") return BUY_COLOR;
  if (operation.action === "sell") return SELL_COLOR;
  return INTEREST_COLOR;
}

/**
 * 将操作记录映射为 K 线标注。
 * 只保留 occurredAt 日期落在 [fromDate, toDate] 内的记录；
 * 同日多条操作合并为一条标注（标题拼接），避免同一根 K 线堆叠过多标记。
 */
export function operationsToKlineAnnotations(
  operations: HoldingOperationWithHolding[],
  fromDate: string,
  toDate: string
): KlineAnnotation[] {
  const inRange = operations.filter((operation) => {
    const date = operation.occurredAt.slice(0, 10);
    return date >= fromDate && date <= toDate;
  });
  if (inRange.length === 0) return [];

  const byDate = new Map<string, HoldingOperationWithHolding[]>();
  for (const operation of inRange) {
    const date = operation.occurredAt.slice(0, 10);
    const group = byDate.get(date);
    if (group === undefined) byDate.set(date, [operation]);
    else group.push(operation);
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([date, group]) => {
      const titles = group.map(operationLabel).join("、");
      const details = group.map(operationDetailLabel).join("\n");
      const colors = group.map(operationColor);
      const hasBuy = group.some((operation) => operation.action === "buy");
      const hasSell = group.some((operation) => operation.action === "sell");
      // 有买入视为多头倾向，有卖出视为空头倾向，计息视为信息提示
      const direction: KlineAnnotation["direction"] = hasSell ? "bearish" : hasBuy ? "bullish" : "bullish";
      const level: KlineAnnotation["level"] = group.length > 1 ? "info" : "info";
      return [{
        indicatorId: "holding-operations",
        date,
        price: null,
        direction,
        level,
        seriesName: "操作",
        title: titles.length > 12 ? `${titles.slice(0, 12)}…` : titles,
        reason: details,
        color: hasSell ? SELL_COLOR : hasBuy ? BUY_COLOR : INTEREST_COLOR,
      }];
    });
}
