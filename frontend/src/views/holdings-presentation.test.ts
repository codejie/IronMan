import { describe, expect, test } from "vitest";
import { holdingProfitSummary, holdingQuoteDateLabel } from "./holdings-presentation";

describe("holdings presentation", () => {
  test("separates active and closed profits for the holdings summary", () => {
    expect(holdingProfitSummary({ principal: 100000, profit: -20005.7 }, [{ profit: 15419 }, { profit: null }])).toEqual({
      activeProfit: -35424.7,
      activeProfitRate: -35.4247,
      closedProfit: 15419,
      totalProfit: -20005.7,
      totalProfitRate: -20.0057
    });
  });

  test("uses a compact month/day label for the current quote date", () => {
    expect(holdingQuoteDateLabel("2026-07-22")).toBe("[07/22]");
    expect(holdingQuoteDateLabel(null)).toBe("[-]");
  });
});
