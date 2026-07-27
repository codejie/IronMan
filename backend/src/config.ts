import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface RuntimeConfig {
  databasePath: string;
  jwtSecret: string;
  tokenTtlSeconds: number;
  akshareProviderUrl?: string;
  akshareProviderTimeoutMs?: number;
}

export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const databasePath = resolve(env.DATABASE_PATH ?? "../data/ironman.sqlite");
  const jwtSecret = env.JWT_SECRET ?? "development-only-secret-change-before-production";
  const tokenTtlSeconds = Number(env.TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7);
  const akshareProviderUrl = env.AKSHARE_PROVIDER_URL ?? "http://127.0.0.1:8001";
  const akshareProviderTimeoutMs = Number(env.AKSHARE_PROVIDER_TIMEOUT_MS ?? 8_000);

  if (!Number.isInteger(tokenTtlSeconds) || tokenTtlSeconds <= 0) {
    throw new Error("TOKEN_TTL_SECONDS must be a positive integer");
  }
  if (!Number.isInteger(akshareProviderTimeoutMs) || akshareProviderTimeoutMs <= 0) {
    throw new Error("AKSHARE_PROVIDER_TIMEOUT_MS must be a positive integer");
  }

  if (jwtSecret.length < 24) {
    throw new Error("JWT_SECRET must contain at least 24 characters");
  }

  mkdirSync(dirname(databasePath), { recursive: true });
  return { databasePath, jwtSecret, tokenTtlSeconds, akshareProviderUrl, akshareProviderTimeoutMs };
}
