import { sign, verify } from "hono/jwt";
import type { RuntimeConfig } from "../config";
import { IronManDatabase } from "../db/database";
import { errors } from "../errors";

export type UserRole = "admin" | "user";

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: UserRole;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: "active" | "disabled";
}

export interface SessionResult {
  token: string;
  expiresAt: string;
  user: PublicUser;
}

interface TokenPayload {
  sub?: string;
  sid?: string;
  role?: UserRole;
  exp?: number;
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorDisplayName: string | null;
  action: string;
  metadata: unknown;
  createdAt: string;
}

export class AuthService {
  constructor(
    private readonly database: IronManDatabase,
    private readonly config: RuntimeConfig
  ) {}

  async register(input: { email: string; password: string; displayName: string }): Promise<SessionResult> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    const passwordHash = await Bun.password.hash(input.password, { algorithm: "argon2id" });
    const now = new Date().toISOString();
    const user = this.database.transaction(() => {
      const existing = this.database.get<{ id: string }>("SELECT id FROM users WHERE email = $email", { email });
      if (existing !== undefined) {
        throw errors.alreadyExists("该邮箱已注册");
      }

      const count = this.database.get<{ count: number }>("SELECT COUNT(*) AS count FROM users")?.count ?? 0;
      const created: UserRecord = {
        id: crypto.randomUUID(),
        email,
        password_hash: passwordHash,
        display_name: displayName,
        role: count === 0 ? "admin" : "user",
        status: "active",
        created_at: now,
        updated_at: now
      };
      this.database.run(
        `INSERT INTO users (id, email, password_hash, display_name, role, status, created_at, updated_at)
         VALUES ($id, $email, $passwordHash, $displayName, $role, $status, $createdAt, $updatedAt)`,
        {
          id: created.id,
          email: created.email,
          passwordHash: created.password_hash,
          displayName: created.display_name,
          role: created.role,
          status: created.status,
          createdAt: created.created_at,
          updatedAt: created.updated_at
        }
      );
      this.writeAudit(created.id, "auth.register", { email: created.email });
      return created;
    });

    return this.createSession(user);
  }

  async login(emailInput: string, password: string): Promise<SessionResult> {
    const email = emailInput.trim().toLowerCase();
    const user = this.database.get<UserRecord>("SELECT * FROM users WHERE email = $email", { email });
    if (user === undefined || user.status !== "active") {
      throw errors.invalidCredentials();
    }

    const isValid = await Bun.password.verify(password, user.password_hash);
    if (!isValid) {
      throw errors.invalidCredentials();
    }

    this.writeAudit(user.id, "auth.login", { email: user.email });
    return this.createSession(user);
  }

  async refresh(token: string): Promise<SessionResult> {
    const currentUser = await this.authenticate(token);
    const payload = await this.verifyPayload(token);
    this.database.run("UPDATE sessions SET revoked_at = $revokedAt WHERE id = $sessionId AND user_id = $userId", {
      revokedAt: new Date().toISOString(),
      sessionId: payload.sid,
      userId: currentUser.id
    });
    const user = this.database.get<UserRecord>("SELECT * FROM users WHERE id = $id", { id: currentUser.id });
    if (user === undefined) {
      throw errors.unauthenticated();
    }
    return this.createSession(user);
  }

  async authenticate(token: string): Promise<PublicUser> {
    const payload = await this.verifyPayload(token);
    const session = this.database.get<{ user_id: string; expires_at: string; revoked_at: string | null }>(
      "SELECT user_id, expires_at, revoked_at FROM sessions WHERE id = $sessionId",
      { sessionId: payload.sid }
    );
    if (
      session === undefined ||
      session.user_id !== payload.sub ||
      session.revoked_at !== null ||
      new Date(session.expires_at).getTime() <= Date.now()
    ) {
      throw errors.unauthenticated();
    }

    const user = this.database.get<UserRecord>("SELECT * FROM users WHERE id = $id", { id: payload.sub });
    if (user === undefined || user.status !== "active") {
      throw errors.unauthenticated();
    }
    return this.toPublicUser(user);
  }

  async logout(token: string): Promise<void> {
    const payload = await this.verifyPayload(token);
    this.database.run("UPDATE sessions SET revoked_at = $revokedAt WHERE id = $sessionId", {
      revokedAt: new Date().toISOString(),
      sessionId: payload.sid
    });
  }

  listUsers(): PublicUser[] {
    return this.database
      .all<UserRecord>("SELECT * FROM users ORDER BY created_at ASC")
      .map((user) => this.toPublicUser(user));
  }

  updateUserStatus(actorId: string, userId: string, status: "active" | "disabled"): void {
    const user = this.database.get<UserRecord>("SELECT * FROM users WHERE id = $id", { id: userId });
    if (user === undefined) {
      throw errors.notFound("用户不存在");
    }
    if (user.id === actorId && status === "disabled") {
      throw errors.validation("不能禁用当前登录管理员");
    }
    this.database.run("UPDATE users SET status = $status, updated_at = $updatedAt WHERE id = $id", {
      id: userId,
      status,
      updatedAt: new Date().toISOString()
    });
    this.writeAudit(actorId, "admin.user-status", { userId, status });
  }

  updateProfile(userId: string, displayNameInput: string): PublicUser {
    const displayName = displayNameInput.trim();
    const user = this.database.get<UserRecord>("SELECT * FROM users WHERE id = $id", { id: userId });
    if (user === undefined) {
      throw errors.unauthenticated();
    }
    const updatedAt = new Date().toISOString();
    this.database.run("UPDATE users SET display_name = $displayName, updated_at = $updatedAt WHERE id = $id", {
      id: userId,
      displayName,
      updatedAt
    });
    this.writeAudit(userId, "account.profile-update", { displayName });
    return this.toPublicUser({ ...user, display_name: displayName, updated_at: updatedAt });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = this.database.get<UserRecord>("SELECT * FROM users WHERE id = $id", { id: userId });
    if (user === undefined) {
      throw errors.unauthenticated();
    }
    if (!(await Bun.password.verify(currentPassword, user.password_hash))) {
      throw errors.validation("当前密码不正确");
    }
    const passwordHash = await Bun.password.hash(newPassword, { algorithm: "argon2id" });
    this.database.run("UPDATE users SET password_hash = $passwordHash, updated_at = $updatedAt WHERE id = $id", {
      id: userId,
      passwordHash,
      updatedAt: new Date().toISOString()
    });
    this.writeAudit(userId, "account.password-change", {});
  }

  recordAudit(actorId: string | null, action: string, metadata: Record<string, unknown>): void {
    this.writeAudit(actorId, action, metadata);
  }

  listAuditLogs(limit: number): AuditLog[] {
    return this.database
      .all<{
        id: string;
        actor_id: string | null;
        actor_email: string | null;
        actor_display_name: string | null;
        action: string;
        metadata_json: string;
        created_at: string;
      }>(
        `SELECT audit_logs.id, audit_logs.actor_id, users.email AS actor_email, users.display_name AS actor_display_name,
                audit_logs.action, audit_logs.metadata_json, audit_logs.created_at
           FROM audit_logs
           LEFT JOIN users ON users.id = audit_logs.actor_id
          ORDER BY audit_logs.created_at DESC
          LIMIT $limit`,
        { limit }
      )
      .map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        actorEmail: row.actor_email,
        actorDisplayName: row.actor_display_name,
        action: row.action,
        metadata: JSON.parse(row.metadata_json),
        createdAt: row.created_at
      }));
  }

  private async createSession(user: UserRecord): Promise<SessionResult> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.config.tokenTtlSeconds * 1000).toISOString();
    this.database.run(
      "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ($id, $userId, $expiresAt, $createdAt)",
      { id: sessionId, userId: user.id, expiresAt, createdAt: new Date().toISOString() }
    );
    const token = await sign(
      {
        sub: user.id,
        sid: sessionId,
        role: user.role,
        exp: Math.floor(new Date(expiresAt).getTime() / 1000)
      },
      this.config.jwtSecret
    );
    return { token, expiresAt, user: this.toPublicUser(user) };
  }

  private async verifyPayload(token: string): Promise<Required<Pick<TokenPayload, "sub" | "sid">> & TokenPayload> {
    try {
      const payload = (await verify(token, this.config.jwtSecret, "HS256")) as TokenPayload;
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string") {
        throw errors.unauthenticated();
      }
      return payload as Required<Pick<TokenPayload, "sub" | "sid">> & TokenPayload;
    } catch {
      throw errors.unauthenticated();
    }
  }

  private toPublicUser(user: UserRecord): PublicUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: user.role,
      status: user.status
    };
  }

  private writeAudit(actorId: string | null, action: string, metadata: Record<string, unknown>): void {
    this.database.run(
      "INSERT INTO audit_logs (id, actor_id, action, metadata_json, created_at) VALUES ($id, $actorId, $action, $metadata, $createdAt)",
      {
        id: crypto.randomUUID(),
        actorId,
        action,
        metadata: JSON.stringify(metadata),
        createdAt: new Date().toISOString()
      }
    );
  }
}
