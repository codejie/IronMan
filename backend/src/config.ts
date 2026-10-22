import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { MarketDataProvider } from "./market/types";

export interface RuntimeConfig {
  databasePath: string;
  jwtSecret: string;
  tokenTtlSeconds: number;
  akshareProviderUrl?: string;
  akshareProviderTimeoutMs?: number;
  /** Overrides the real market providers (tests inject offline fixtures here; production must not use mocks). */
  marketProviders?: MarketDataProvider[];
}

export interface ServerConfig {
  host: string;
  port: number;
}

function configuredHost(value: string | undefined, fallback: string): string {
  const host = value?.trim() ?? fallback;
  if (host === "") throw new Error("Host must not be empty");
  return host;
}

function configuredPort(value: string | undefined, name: string, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return port;
}

export function loadServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  return {
    host: configuredHost(env.IRONMAN_BACKEND_HOST ?? env.HOST, "127.0.0.1"),
    port: configuredPort(env.IRONMAN_BACKEND_PORT ?? env.PORT, "IRONMAN_BACKEND_PORT", 6101),
  };
}

export function resolveAkshareProviderUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.AKSHARE_PROVIDER_URL !== undefined) return env.AKSHARE_PROVIDER_URL;
  const host = configuredHost(env.AKSHARE_PROVIDER_HOST, "127.0.0.1");
  const port = configuredPort(env.AKSHARE_PROVIDER_PORT, "AKSHARE_PROVIDER_PORT", 6102);
  return `http://${host}:${port}`;
}

export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const databasePath = resolve(env.DATABASE_PATH ?? "../data/ironman.sqlite");
  const jwtSecret = env.JWT_SECRET ?? "development-only-secret-change-before-production";
  const tokenTtlSeconds = Number(env.TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7);
  const akshareProviderUrl = resolveAkshareProviderUrl(env);
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
