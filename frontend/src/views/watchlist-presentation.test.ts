import { describe, expect, test } from "vitest";
import { DEFAULT_REALTIME_ENABLED, watchlistCodeLabel, watchlistInstrumentType } from "./watchlist-presentation";

describe("watchlist presentation", () => {
  test("keeps realtime updates off until the user enables them", () => {
    expect(DEFAULT_REALTIME_ENABLED).toBe(false);
  });

  test("formats stock, index, ETF, LOF and open-fund codes for the Batman table", () => {
    expect(watchlistCodeLabel({ assetType: "stock", code: "600000" })).toBe("[股票] 600000");
    expect(watchlistCodeLabel({ assetType: "index", code: "000300" })).toBe("[指数] 000300");
    expect(watchlistInstrumentType({ assetType: "fund", code: "563230" })).toBe("ETF");
    expect(watchlistInstrumentType({ assetType: "fund", code: "161725" })).toBe("LOF");
    expect(watchlistInstrumentType({ assetType: "fund", code: "000001" })).toBe("基金");
  });
});
