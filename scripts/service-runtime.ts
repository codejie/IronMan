import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const projectRoot = resolve(import.meta.dir, "..");
const runtimeDirectory = join(projectRoot, ".ironman", "service");
const manifestPath = join(runtimeDirectory, "processes.json");

export type ServiceProcessName = "akshare" | "backend" | "frontend";

export interface ServiceProcess {
  name: ServiceProcessName;
  pid: number;
  commandMarker: string;
}

export interface ServiceManifest {
  processes: ServiceProcess[];
  startedAt: string;
}

export function logPath(name: ServiceProcessName): string {
  return join(runtimeDirectory, `${name}.log`);
}

export function requireBuiltArtifacts(): void {
  const missing = [
    "backend/dist/server.js",
    "frontend/dist/index.html",
  ].filter((path) => !existsSync(join(projectRoot, path)));
  if (missing.length > 0) {
    throw new Error(`缺少构建产物：${missing.join(", ")}。请先执行：bun run service:build`);
  }
}

export function prepareRuntimeDirectory(): void {
  mkdirSync(runtimeDirectory, { recursive: true });
}

export function readManifest(): ServiceManifest | null {
  if (!existsSync(manifestPath)) return null;
  try {
    const value = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<ServiceManifest>;
    if (!Array.isArray(value.processes) || typeof value.startedAt !== "string") return null;
    const processes = value.processes.filter(isServiceProcess);
    return processes.length === value.processes.length ? { processes, startedAt: value.startedAt } : null;
  } catch {
    return null;
  }
}

export function writeManifest(processes: ServiceProcess[]): void {
  prepareRuntimeDirectory();
  writeFileSync(manifestPath, `${JSON.stringify({ processes, startedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

export function removeManifest(): void {
  rmSync(manifestPath, { force: true });
}

export function configuredPort(value: string | undefined, name: string, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} 必须是 1 到 65535 之间的整数`);
  }
  return port;
}

export function configuredHost(value: string | undefined, name: string, fallback: string): string {
  const host = value?.trim() ?? fallback;
  if (host === "") throw new Error(`${name} 不能为空`);
  return host;
}

export function connectionHost(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return host;
}

export async function processCommand(pid: number): Promise<string | null> {
  const process = Bun.spawn(["ps", "-p", String(pid), "-o", "command="], { stdout: "pipe", stderr: "ignore" });
  const output = (await new Response(process.stdout).text()).trim();
  await process.exited;
  return output === "" ? null : output;
}

export async function isManagedProcessRunning(process: ServiceProcess): Promise<boolean> {
  const command = await processCommand(process.pid);
  return command !== null && command.includes(process.commandMarker);
}

export async function listeningPids(port: number): Promise<number[]> {
  const process = Bun.spawn(["lsof", "-nP", "-ti", `tcp:${port}`, "-sTCP:LISTEN"], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(process.stdout).text();
  await process.exited;
  return output.split("\n").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0);
}

function isServiceProcess(value: unknown): value is ServiceProcess {
  if (typeof value !== "object" || value === null) return false;
  const process = value as Partial<ServiceProcess>;
  return (process.name === "akshare" || process.name === "backend" || process.name === "frontend")
    && Number.isInteger(process.pid)
    && typeof process.commandMarker === "string";
}
