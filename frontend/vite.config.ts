import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

function configuredPort(value: string | undefined, name: string, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`${name} must be an integer between 1 and 65535`);
  return port;
}

export default defineConfig(({ mode }) => {
  const envDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const env = loadEnv(mode, envDirectory, "");
  const frontendHost = env.IRONMAN_FRONTEND_HOST ?? "127.0.0.1";
  const frontendPort = configuredPort(env.IRONMAN_FRONTEND_PORT, "IRONMAN_FRONTEND_PORT", 6100);
  const backendHost = env.IRONMAN_BACKEND_HOST ?? "127.0.0.1";
  const backendPort = configuredPort(env.IRONMAN_BACKEND_PORT, "IRONMAN_BACKEND_PORT", 6101);
  const proxyTarget = env.VITE_PROXY_TARGET ?? `http://${backendHost}:${backendPort}`;

  return {
    envDir: envDirectory,
    plugins: [vue()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      host: frontendHost,
      port: frontendPort,
      strictPort: true,
      proxy: {
        "/api": proxyTarget,
        "/openapi.json": proxyTarget
      }
    },
    test: {
      environment: "jsdom"
    }
  };
});
