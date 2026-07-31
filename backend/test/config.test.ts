import { expect, test } from "bun:test";
import { loadRuntimeConfig, loadServerConfig } from "../src/config";

test("loads backend and AKShare endpoints from host and port settings", () => {
  const environment = {
    DATABASE_PATH: "/tmp/ironman-config-test.sqlite",
    IRONMAN_BACKEND_HOST: "127.0.0.1",
    IRONMAN_BACKEND_PORT: "6101",
    AKSHARE_PROVIDER_HOST: "127.0.0.1",
    AKSHARE_PROVIDER_PORT: "6102",
    JWT_SECRET: "test-secret-that-is-long-enough",
  };

  expect(loadServerConfig(environment)).toEqual({ host: "127.0.0.1", port: 6101 });
  expect(loadRuntimeConfig(environment).akshareProviderUrl).toBe("http://127.0.0.1:6102");
});

test("rejects an invalid configured backend port", () => {
  expect(() => loadServerConfig({ IRONMAN_BACKEND_PORT: "not-a-port" })).toThrow(
    "IRONMAN_BACKEND_PORT must be an integer between 1 and 65535",
  );
});
