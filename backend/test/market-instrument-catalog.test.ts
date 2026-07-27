import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IronManDatabase } from "../src/db/database";
import type { InstrumentCatalogProvider, MarketDataProvider } from "../src/market/types";
import { MarketService } from "../src/services/market-service";
import { SettingsService } from "../src/services/settings-service";

let tempDirectory = "";
let database: IronManDatabase;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-instrument-catalog-"));
  database = new IronManDatabase(join(tempDirectory, "ironman.sqlite"));
});

afterEach(() => {
  database.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});

describe("market instrument catalog fallback", () => {
  test("resolves a missing index without colliding with the same stock code", async () => {
    const calls: Array<["stock" | "index" | "fund", string]> = [];
    const catalog = catalogProvider(calls);
    const market = new MarketService(database, new SettingsService(database), [catalog]);
    market.upsertInstrument({ assetType: "stock", code: "000001", exchange: "sz", name: "平安银行" });

    const items = await market.search("000001", "index");

    expect(calls).toEqual([["index", "000001"]]);
    expect(items).toEqual([expect.objectContaining({ assetType: "index", code: "000001", exchange: "sh", name: "上证指数" })]);
    expect(await market.search("000001", "stock")).toEqual([expect.objectContaining({ assetType: "stock", code: "000001", name: "平安银行" })]);
  });
});

function catalogProvider(calls: Array<["stock" | "index" | "fund", string]>): MarketDataProvider & InstrumentCatalogProvider {
  return {
    source: "akshare",
    history: async () => [],
    searchInstruments: async (assetType, query) => {
      calls.push([assetType, query]);
      if (assetType === "index" && query === "000001") {
        return [{ assetType: "index" as const, code: "000001", exchange: "sh" as const, name: "上证指数" }];
      }
      return [];
    }
  };
}
