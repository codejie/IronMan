import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  configuredHost,
  configuredPort,
  connectionHost,
  isManagedProcessRunning,
  listeningPids,
  logPath,
  prepareRuntimeDirectory,
  projectRoot,
  readManifest,
  removeManifest,
  requireBuiltArtifacts,
  type ServiceProcess,
  writeManifest,
} from "./service-runtime";

const providerHost = configuredHost(process.env.AKSHARE_PROVIDER_HOST, "AKSHARE_PROVIDER_HOST", "127.0.0.1");
const providerPort = configuredPort(process.env.AKSHARE_PROVIDER_PORT, "AKSHARE_PROVIDER_PORT", 6102);
const providerUrl = process.env.AKSHARE_PROVIDER_URL ?? `http://${connectionHost(providerHost)}:${providerPort}`;
const providerAutoStart = process.env.AKSHARE_PROVIDER_AUTOSTART !== "false";
const backendHost = configuredHost(process.env.IRONMAN_BACKEND_HOST, "IRONMAN_BACKEND_HOST", "127.0.0.1");
const backendPort = configuredPort(process.env.IRONMAN_BACKEND_PORT, "IRONMAN_BACKEND_PORT", 6101);
const frontendHost = configuredHost(process.env.IRONMAN_FRONTEND_HOST, "IRONMAN_FRONTEND_HOST", "127.0.0.1");
const frontendPort = configuredPort(process.env.IRONMAN_FRONTEND_PORT, "IRONMAN_FRONTEND_PORT", 6100);
const started: ServiceProcess[] = [];

try {
  requireBuiltArtifacts();
  await ensureNoManagedServiceIsRunning();
  await ensurePortsAreAvailable();
  prepareRuntimeDirectory();

  if (providerAutoStart) {
    start("akshare", ["bun", "scripts/run-akshare-provider.ts"], "run-akshare-provider.ts");
    await waitForHealthy(`${providerUrl.replace(/\/$/, "")}/health`, "POST", "AKShareProvider");
  }

  start("backend", ["bun", "dist/server.js"], "dist/server.js", resolve(projectRoot, "backend"));
  await waitForHealthy(`http://${connectionHost(backendHost)}:${backendPort}/api/health`, "POST", "后端");

  start("frontend", ["bun", "scripts/service-static-server.ts"], "service-static-server.ts");
  await waitForHealthy(`http://${connectionHost(frontendHost)}:${frontendPort}/`, "GET", "前端静态服务");

  writeManifest(started);
  console.info(`IronMan 生产服务已启动：http://${connectionHost(frontendHost)}:${frontendPort}`);
} catch (error) {
  await stopStartedProcesses();
  console.error(error instanceof Error ? error.message : "IronMan 生产服务启动失败");
  process.exit(1);
}

function start(name: ServiceProcess["name"], command: string[], commandMarker: string, cwd = projectRoot): void {
  const filePath = logPath(name);
  writeFileSync(filePath, "");
  const logFile = Bun.file(filePath);
  const child = Bun.spawn({
    cmd: command,
    cwd,
    env: process.env,
    stdout: logFile,
    stderr: logFile,
  });
  started.push({ name, pid: child.pid, commandMarker });
}

async function ensureNoManagedServiceIsRunning(): Promise<void> {
  const manifest = readManifest();
  if (manifest === null) return;
  const running = [] as ServiceProcess[];
  for (const process of manifest.processes) {
    if (await isManagedProcessRunning(process)) running.push(process);
  }
  if (running.length > 0) {
    throw new Error(`IronMan 生产服务已在运行（PID: ${running.map((process) => process.pid).join(", ")}）。请先执行：bun run service:stop`);
  }
  removeManifest();
}

async function ensurePortsAreAvailable(): Promise<void> {
  const ports = [frontendPort, backendPort, ...(providerAutoStart ? [providerPort] : [])];
  for (const port of ports) {
    const pids = await listeningPids(port);
    if (pids.length > 0) throw new Error(`端口 ${port} 已被占用（PID: ${pids.join(", ")}）`);
  }
}

async function waitForHealthy(url: string, method: "GET" | "POST", name: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? "{}" : undefined,
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // The process may still be opening its listener.
    }
    await setTimeout(250);
  }
  throw new Error(`${name} 未在预期时间内就绪。请查看 .ironman/service/*.log`);
}

async function stopStartedProcesses(): Promise<void> {
  for (const entry of [...started].reverse()) {
    try {
      process.kill(entry.pid, "SIGTERM");
    } catch {
      // A failed child can already have exited.
    }
  }
}
