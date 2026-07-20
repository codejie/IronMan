import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface RuntimeConfig {
  databasePath: string;
  jwtSecret: string;
  tokenTtlSeconds: number;
}

export function loadRuntimeConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  const databasePath = resolve(env.DATABASE_PATH ?? "../data/ironman.sqlite");
  const jwtSecret = env.JWT_SECRET ?? "development-only-secret-change-before-production";
  const tokenTtlSeconds = Number(env.TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 7);

  if (!Number.isInteger(tokenTtlSeconds) || tokenTtlSeconds <= 0) {
    throw new Error("TOKEN_TTL_SECONDS must be a positive integer");
  }

  if (jwtSecret.length < 24) {
    throw new Error("JWT_SECRET must contain at least 24 characters");
  }

  mkdirSync(dirname(databasePath), { recursive: true });
  return { databasePath, jwtSecret, tokenTtlSeconds };
}
