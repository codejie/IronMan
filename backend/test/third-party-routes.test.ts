import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ApiResponse<T> {
  code: number;
  message?: string;
  result: T;
}

interface Session {
  token: string;
}

let directory = "";
let runtime: IronManRuntime;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "ironman-third-party-routes-"));
  runtime = createApp({ databasePath: join(directory, "ironman.sqlite"), jwtSecret: "test-secret-that-is-long-enough", tokenTtlSeconds: 3600 });
});

afterEach(() => {
  runtime.close();
  rmSync(directory, { force: true, recursive: true });
});

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  return runtime.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body)
  });
}

async function register(): Promise<Session> {
  const response = await post("/api/auth/register", { email: "third-party-routes@example.com", password: "a-strong-test-password", displayName: "Third Party" });
  return ((await response.json()) as ApiResponse<Session>).result;
}

describe("third-party-data routes", () => {
  test("requires authentication and exposes Batman-compatible links and market cloud", async () => {
    expect((await post("/api/third-party/info-links", {})).status).toBe(401);

    const session = await register();
    const links = await post("/api/third-party/info-links", {}, session.token);
    const linkBody = (await links.json()) as ApiResponse<{ groups: Array<{ label: string; links: Array<{ needCode: boolean }> }> }>;
    expect(links.status).toBe(200);
    expect(linkBody.result.groups.map((group) => group.label)).toContain("个股数据");
    expect(linkBody.result.groups.find((group) => group.label === "个股数据")?.links.some((link) => link.needCode)).toBe(true);

    const cloud = await post("/api/third-party/market-cloud", {}, session.token);
    const cloudBody = (await cloud.json()) as ApiResponse<{ title: string; url: string }>;
    expect(cloud.status).toBe(200);
    expect(cloudBody.result).toMatchObject({ title: "52ETF 大盘云图", url: "https://52etf.site" });
  });
});
