import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type IronManRuntime } from "../src/app";

interface ResponseBody<T> {
  code: number;
  message?: string;
  result: T;
}

interface RegisteredUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "user";
}

interface SessionResult {
  token: string;
  expiresAt: string;
  user: RegisteredUser;
}

let tempDirectory = "";
let runtime: IronManRuntime;

beforeEach(() => {
  tempDirectory = mkdtempSync(join(tmpdir(), "ironman-test-"));
  runtime = createApp({
    databasePath: join(tempDirectory, "ironman.sqlite"),
    jwtSecret: "test-secret-that-is-long-enough",
    tokenTtlSeconds: 60 * 60
  });
});

afterEach(() => {
  runtime.close();
  rmSync(tempDirectory, { force: true, recursive: true });
});

async function post<T>(path: string, body: unknown, token?: string): Promise<Response> {
  return runtime.app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function register(email: string, displayName: string): Promise<SessionResult> {
  const response = await post("/api/auth/register", {
    displayName,
    email,
    password: "a-strong-test-password"
  });
  const body = (await response.json()) as ResponseBody<SessionResult>;

  expect(response.status).toBe(201);
  expect(body.code).toBe(0);
  return body.result;
}

describe("account and tenant isolation", () => {
  test("registers the first user as administrator and issues a session", async () => {
    const session = await register("admin@example.com", "Admin");

    expect(session.user.role).toBe("admin");
    expect(session.token).toBeString();
    expect(session.expiresAt).toContain("T");
  });

  test("prevents one user from reading another user's settings", async () => {
    const alice = await register("alice@example.com", "Alice");
    const bob = await register("bob@example.com", "Bob");

    const update = await post(
      "/api/settings/upsert",
      { key: "dashboard.layout", value: { columns: 3 } },
      alice.token
    );
    expect(update.status).toBe(200);

    const aliceSettings = await post<ResponseBody<{ items: Array<{ key: string }> }>>(
      "/api/settings/list",
      {},
      alice.token
    );
    const bobSettings = await post<ResponseBody<{ items: Array<{ key: string }> }>>(
      "/api/settings/list",
      {},
      bob.token
    );

    expect(((await aliceSettings.json()) as ResponseBody<{ items: Array<{ key: string }> }>).result.items).toHaveLength(1);
    expect(((await bobSettings.json()) as ResponseBody<{ items: Array<{ key: string }> }>).result.items).toHaveLength(0);
  });

  test("enforces administrator routes and revokes logged out sessions", async () => {
    const admin = await register("admin@example.com", "Admin");
    const user = await register("user@example.com", "User");

    const denied = await post("/api/admin/users/list", {}, user.token);
    const deniedBody = (await denied.json()) as ResponseBody<null>;
    expect(denied.status).toBe(403);
    expect(deniedBody.code).toBe(10003);

    const allowed = await post("/api/admin/users/list", {}, admin.token);
    const allowedBody = (await allowed.json()) as ResponseBody<{ items: RegisteredUser[] }>;
    expect(allowed.status).toBe(200);
    expect(allowedBody.result.items).toHaveLength(2);

    const logout = await post("/api/auth/logout", {}, user.token);
    expect(logout.status).toBe(200);

    const profile = await post("/api/account/me", {}, user.token);
    const profileBody = (await profile.json()) as ResponseBody<null>;
    expect(profile.status).toBe(401);
    expect(profileBody.code).toBe(10002);
  });

  test("allows an authenticated user to update their own profile and password", async () => {
    const session = await register("owner@example.com", "Original");

    const update = await post("/api/account/profile/update", { displayName: "Updated" }, session.token);
    const updateBody = (await update.json()) as ResponseBody<RegisteredUser>;
    expect(update.status).toBe(200);
    expect(updateBody.result.displayName).toBe("Updated");

    const password = await post(
      "/api/account/password/change",
      { currentPassword: "a-strong-test-password", newPassword: "another-strong-password" },
      session.token
    );
    expect(password.status).toBe(200);

    const oldLogin = await post("/api/auth/login", {
      email: "owner@example.com",
      password: "a-strong-test-password"
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await post("/api/auth/login", {
      email: "owner@example.com",
      password: "another-strong-password"
    });
    expect(newLogin.status).toBe(200);
  });

  test("stores each user's trading calendar independently", async () => {
    const alice = await register("alice@example.com", "Alice");
    const bob = await register("bob@example.com", "Bob");
    const update = await post("/api/settings/trading-calendar/update", { nonTradingDays: ["2026-10-01", "2026-10-02"] }, alice.token);
    expect(update.status).toBe(200);
    const aliceCalendar = await post("/api/settings/trading-calendar/get", {}, alice.token);
    const bobCalendar = await post("/api/settings/trading-calendar/get", {}, bob.token);
    expect(((await aliceCalendar.json()) as ResponseBody<{ nonTradingDays: string[] }>).result.nonTradingDays).toHaveLength(2);
    expect(((await bobCalendar.json()) as ResponseBody<{ nonTradingDays: string[] }>).result.nonTradingDays).toHaveLength(0);
  });

  test("exposes audit and system state to administrators through POST routes only", async () => {
    const admin = await register("admin@example.com", "Admin");
    await register("user@example.com", "User");

    const audit = await post("/api/admin/audit-logs/list", { limit: 20 }, admin.token);
    const auditBody = (await audit.json()) as ResponseBody<{ items: Array<{ action: string }> }>;
    expect(audit.status).toBe(200);
    expect(auditBody.result.items.some((item) => item.action === "auth.register")).toBe(true);

    const system = await post("/api/admin/system/status", {}, admin.token);
    const systemBody = (await system.json()) as ResponseBody<{ database: string; migrationVersions: number[] }>;
    expect(system.status).toBe(200);
    expect(systemBody.result.database).toBe("sqlite");
    expect(systemBody.result.migrationVersions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const wrongMethod = await runtime.app.request("/api/admin/system/status", { method: "GET" });
    expect(wrongMethod.status).toBe(404);
  });
});
