import { describe, expect, test } from "vitest";
import type { HoldingOperation } from "@/api/client";
import {
  operationColor,
  operationDetailLabel,
  operationLabel,
  operationsToKlineAnnotations,
  type HoldingOperationWithHolding
} from "./kline-operations";

function operation(overrides: Partial<HoldingOperationWithHolding> = {}): HoldingOperationWithHolding {
  return {
    id: "operation-1",
    holdingId: "holding-1",
    action: "buy",
    quantity: 100,
    price: 10,
    fee: 1,
    cashImpact: -1001,
    occurredAt: "2026-03-10T09:30:00.000Z",
    note: "",
    ...overrides
  };
}

describe("operationsToKlineAnnotations", () => {
  test("returns empty for no operations", () => {
    expect(operationsToKlineAnnotations([], "2026-03-01", "2026-03-31")).toEqual([]);
  });

  test("filters operations by date range", () => {
    const operations = [
      operation({ id: "op-1", occurredAt: "2026-01-15T09:30:00.000Z" }),
      operation({ id: "op-2", occurredAt: "2026-03-10T09:30:00.000Z" }),
      operation({ id: "op-3", occurredAt: "2026-04-10T09:30:00.000Z" })
    ];
    const result = operationsToKlineAnnotations(operations, "2026-03-01", "2026-03-31");
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-10");
  });

  test("maps buy operation to bullish annotation with red color", () => {
    const result = operationsToKlineAnnotations([operation({ action: "buy" })], "2026-03-01", "2026-03-31");
    expect(result).toHaveLength(1);
    expect(result[0]!.direction).toBe("bullish");
    expect(result[0]!.color).toBe("#fa7575");
  });

  test("maps sell operation to bearish annotation with green color", () => {
    const result = operationsToKlineAnnotations([operation({ action: "sell", quantity: -100 })], "2026-03-01", "2026-03-31");
    expect(result[0]!.direction).toBe("bearish");
    expect(result[0]!.color).toBe("#68d991");
  });

  test("maps interest operation to info-level annotation with amber color", () => {
    const result = operationsToKlineAnnotations([operation({ action: "interest", quantity: 0, price: 0.5 })], "2026-03-01", "2026-03-31");
    expect(result[0]!.level).toBe("info");
    expect(result[0]!.color).toBe("#ffbd4b");
  });

  test("marks operation annotations with the 操作 series name", () => {
    const result = operationsToKlineAnnotations([operation({ action: "buy" })], "2026-03-01", "2026-03-31");
    expect(result[0]!.seriesName).toBe("操作");
  });

  test("merges same-day operations into one annotation with combined title", () => {
    const operations = [
      operation({ id: "op-1", action: "buy", quantity: 100, price: 10, occurredAt: "2026-03-10T09:30:00.000Z" }),
      operation({ id: "op-2", action: "sell", quantity: -50, price: 12, occurredAt: "2026-03-10T14:30:00.000Z" })
    ];
    const result = operationsToKlineAnnotations(operations, "2026-03-01", "2026-03-31");
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toContain("买入");
    expect(result[0]!.title).toContain("卖出");
    // 混合操作：有卖出发出
    expect(result[0]!.direction).toBe("bearish");
  });

  test("keeps operations in date order", () => {
    const operations = [
      operation({ id: "op-3", occurredAt: "2026-03-20T09:30:00.000Z" }),
      operation({ id: "op-1", occurredAt: "2026-03-05T09:30:00.000Z" }),
      operation({ id: "op-2", occurredAt: "2026-03-15T09:30:00.000Z" })
    ];
    const result = operationsToKlineAnnotations(operations, "2026-03-01", "2026-03-31");
    expect(result.map((annotation) => annotation.date)).toEqual(["2026-03-05", "2026-03-15", "2026-03-20"]);
  });
});

describe("operationLabel", () => {
  test("shows action and quantity for buy", () => {
    expect(operationLabel(operation({ action: "buy", quantity: 100 }))).toBe("买入 100");
  });

  test("shows absolute quantity for sell", () => {
    expect(operationLabel(operation({ action: "sell", quantity: -100 }))).toBe("卖出 100");
  });

  test("shows price and note in detail label", () => {
    expect(operationDetailLabel(operation({ price: 10, fee: 1, note: "低价买入", occurredAt: "2026-03-10T00:00:00.000Z" }))).toBe(
      "价格 10 · 费用 1 · 时间 2026-03-10 · 备注 低价买入"
    );
  });

  test("uses amber color for interest", () => {
    expect(operationColor(operation({ action: "interest" }))).toBe("#ffbd4b");
  });
});
