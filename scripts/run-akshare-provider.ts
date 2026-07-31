import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const providerDirectory = resolve(root, "akshare-provider");
const virtualPython = process.platform === "win32"
  ? resolve(providerDirectory, ".venv", "Scripts", "python.exe")
  : resolve(providerDirectory, ".venv", "bin", "python");

if (!existsSync(virtualPython)) {
  console.error("AKShareProvider 尚未初始化。请先执行：bun run akshare:setup");
  process.exit(1);
}

const host = process.env.AKSHARE_PROVIDER_HOST ?? "127.0.0.1";
const port = process.env.AKSHARE_PROVIDER_PORT ?? "6102";
const provider = Bun.spawn({
  cmd: [virtualPython, "-m", "uvicorn", "akshare_provider.main:app", "--host", host, "--port", port],
  cwd: providerDirectory,
  env: { ...process.env, PYTHONPATH: [providerDirectory, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
  stdout: "inherit",
  stderr: "inherit"
});

const shutdown = (signal: NodeJS.Signals): void => provider.kill(signal);
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.exit(await provider.exited);
