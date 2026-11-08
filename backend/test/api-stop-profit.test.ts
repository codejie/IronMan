import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";
import { FixtureMarketProvider } from "./helpers/fixture-market-provider";

interface ApiResponse<T> { code: number; result: T; }
let tempDirectory = "";
let runtime: IronManRuntime;
beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-sp-"));
  runtime = createApp({ databasePath: join(tempDirectory, "ironman.sqlite"), jwtSecret: "test-secret-that-is-long-enough", tokenTtlSeconds: 3600, marketProviders: [new FixtureMarketProvider("eastmoney"), new FixtureMarketProvider("tencent")] });
});
afterEach(() => { runtime.close(); rmSync(tempDirectory, { force: true, recursive: true }); });
async function post(path: string, body: unknown, token?: string) {
  return runtime.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
}
async function register(email: string) {
  const r = await post("/api/auth/register", { email, password: "a-strong-test-password", displayName: email.split("@")[0] });
  return ((await r.json()) as ApiResponse<{ token: string }>).result;
}

describe("stop-profit settings API", () => {
  test("gets defaults then updates and isolates per user", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const get0 = await post("/api/settings/stop-profit/get", {}, alice.token);
    expect(get0.status).toBe(200);
    const body0 = (await get0.json()) as ApiResponse<{ stopLoss: { strategy: string }; takeProfit: { strategy: string }; risk: { riskPerTradePercent: number } }>;
    expect(body0.result.stopLoss.strategy).toBe("fixed_percentage");
    expect(body0.result.takeProfit.strategy).toBe("risk_reward");

    const update = await post("/api/settings/stop-profit/update", { stopLoss: { strategy: "atr", atrMultiplier: 2.5 }, takeProfit: { strategy: "scaled", scaleStages: [{ ratio: 1, sellPercent: 50 }, { ratio: 2, sellPercent: 30 }] }, risk: { riskPerTradePercent: 2 } }, alice.token);
    expect(update.status).toBe(200);
    const body = (await update.json()) as ApiResponse<{ stopLoss: { strategy: string; atrMultiplier: number }; risk: { riskPerTradePercent: number } }>;
    expect(body.result.stopLoss.strategy).toBe("atr");
    expect(body.result.stopLoss.atrMultiplier).toBe(2.5);
    expect(body.result.risk.riskPerTradePercent).toBe(2);

    const getBob = await post("/api/settings/stop-profit/get", {}, bob.token);
    const bobBody = (await getBob.json()) as ApiResponse<{ stopLoss: { strategy: string } }>;
    expect(bobBody.result.stopLoss.strategy).toBe("fixed_percentage");
  });
});
