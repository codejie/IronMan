import { setTimeout } from "node:timers/promises";

const backendMode = process.argv[2] === "start" ? "start" : "dev";
const providerUrl = process.env.AKSHARE_PROVIDER_URL ?? "http://127.0.0.1:8001";
const autoStart = process.env.AKSHARE_PROVIDER_AUTOSTART !== "false";

let provider: ReturnType<typeof Bun.spawn> | null = null;

async function waitForProvider(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (provider !== null && provider.exitCode !== null) {
      throw new Error("AKShareProvider 启动失败");
    }
    try {
      const response = await fetch(`${providerUrl.replace(/\/$/, "")}/health`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(500)
      });
      if (response.ok) return;
    } catch {
      // The backend has its own provider fallback. Keep polling briefly for local startup.
    }
    await setTimeout(250);
  }
  throw new Error(`AKShareProvider 未在 ${providerUrl} 就绪`);
}

try {
  if (autoStart) {
    provider = Bun.spawn({ cmd: ["bun", "run", "dev:akshare"], stdout: "inherit", stderr: "inherit" });
    await waitForProvider();
  }
} catch (error) {
  provider?.kill("SIGTERM");
  console.error(error instanceof Error ? error.message : "AKShareProvider 启动失败");
  process.exit(1);
}

const backend = Bun.spawn({ cmd: ["bun", "run", "--cwd", "backend", backendMode], stdout: "inherit", stderr: "inherit" });
const shutdown = (signal: NodeJS.Signals): void => {
  backend.kill(signal);
  provider?.kill(signal);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

const exitCode = await backend.exited;
provider?.kill("SIGTERM");
process.exit(exitCode);
