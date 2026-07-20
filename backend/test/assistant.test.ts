import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ApiResponse<T> { code: number; result: T }
interface Session { token: string }
let tempDirectory = "";
let runtime: IronManRuntime;
beforeEach(() => { tempDirectory = mkdtempSync(join(tmpdir(), "ironman-assistant-")); runtime = createApp({ databasePath: join(tempDirectory, "ironman.sqlite"), jwtSecret: "test-secret-that-is-long-enough", tokenTtlSeconds: 3600 }); });
afterEach(() => { runtime.close(); rmSync(tempDirectory, { force: true, recursive: true }); });
async function post(path: string, body: unknown, token?: string): Promise<Response> { return runtime.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) }); }
async function register(email: string): Promise<Session> { const response = await post("/api/auth/register", { email, password: "a-strong-test-password", displayName: email.split("@")[0] }); return ((await response.json()) as ApiResponse<Session>).result; }

describe("AI consultation", () => {
  test("answers with the current user's local workspace summary without exposing another user", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    await post("/api/assets/cash/adjust", { amount: 8888, note: "资金" }, alice.token);
    await post("/api/assets/cash/adjust", { amount: 1234, note: "资金" }, bob.token);

    const answer = await post("/api/assistant/chat", { message: "请总结我的资产" }, alice.token);
    const body = (await answer.json()) as ApiResponse<{ content: string; provider: string }>;
    expect(answer.status).toBe(200);
    expect(body.result.provider).toBe("local");
    expect(body.result.content).toContain("8888");
    expect(body.result.content).not.toContain("1234");
  });
});
