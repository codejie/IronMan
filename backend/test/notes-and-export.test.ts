import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ApiResponse<T> { code: number; result: T }
interface Session { token: string }

let tempDirectory = "";
let runtime: IronManRuntime;
beforeEach(() => { tempDirectory = mkdtempSync(join(tmpdir(), "ironman-notes-")); runtime = createApp({ databasePath: join(tempDirectory, "ironman.sqlite"), jwtSecret: "test-secret-that-is-long-enough", tokenTtlSeconds: 3600 }); });
afterEach(() => { runtime.close(); rmSync(tempDirectory, { force: true, recursive: true }); });

async function post(path: string, body: unknown, token?: string): Promise<Response> { return runtime.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) }); }
async function register(email: string): Promise<Session> { const response = await post("/api/auth/register", { email, password: "a-strong-test-password", displayName: email.split("@")[0] }); return ((await response.json()) as ApiResponse<Session>).result; }

describe("notes and user data portability", () => {
  test("isolates notes and exports only the current user's private records", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const created = await post("/api/notes/create", { title: "复盘", content: "观察趋势和仓位", tags: ["复盘", "ETF"], instrumentId: null }, alice.token);
    expect(created.status).toBe(201);

    const aliceNotes = await post("/api/notes/list", {}, alice.token);
    const bobNotes = await post("/api/notes/list", {}, bob.token);
    expect(((await aliceNotes.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(1);
    expect(((await bobNotes.json()) as ApiResponse<{ items: unknown[] }>).result.items).toHaveLength(0);

    await post("/api/settings/upsert", { key: "workspace.density", value: "compact" }, alice.token);
    const exported = await post("/api/settings/data/export", {}, alice.token);
    const body = (await exported.json()) as ApiResponse<{ version: number; data: { notes: Array<{ title: string }>; settings: Array<{ key: string }> } }>;
    expect(exported.status).toBe(200);
    expect(body.result.version).toBe(1);
    expect(body.result.data.notes[0]?.title).toBe("复盘");
    expect(body.result.data.settings[0]?.key).toBe("workspace.density");
    expect(JSON.stringify(body)).not.toContain("password_hash");
    expect(JSON.stringify(body)).not.toContain("bob@example.com");
  });
});
