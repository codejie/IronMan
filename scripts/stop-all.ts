#!/usr/bin/env bun

import { existsSync } from "node:fs";

const ports = ["6100", "6101", "6102"];
const patterns = ["vite", "akshare_provider", "run-backend", "run-all"];

async function findPidsByPort(port: string): Promise<number[]> {
  try {
    const proc = Bun.spawn(["lsof", "-ti", `tcp:${port}`], { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    return output.trim().split("\n").filter(Boolean).map(Number).filter((n): n is number => !isNaN(n));
  } catch {
    return [];
  }
}

async function findPidsByPattern(pattern: string): Promise<number[]> {
  try {
    const proc = Bun.spawn(["pgrep", "-f", pattern], { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    return output.trim().split("\n").filter(Boolean).map(Number).filter((n): n is number => !isNaN(n));
  } catch {
    return [];
  }
}

async function killPid(pid: number, signal: string = "SIGTERM"): Promise<boolean> {
  try {
    process.kill(pid, signal as NodeJS.Signals);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const signal = process.argv[2] === "-9" ? "SIGKILL" : "SIGTERM";
  const allPids = new Set<number>();

  console.log(`正在查找运行在端口 ${ports.join(", ")} 上的进程...`);
  for (const port of ports) {
    const pids = await findPidsByPort(port);
    pids.forEach((p) => allPids.add(p));
  }

  console.log(`正在查找匹配模式 ${patterns.join(", ")} 的进程...`);
  for (const pattern of patterns) {
    const pids = await findPidsByPattern(pattern);
    pids.forEach((p) => allPids.add(p));
  }

  if (allPids.size === 0) {
    console.log("未找到相关进程");
    return;
  }

  console.log(`找到进程: ${Array.from(allPids).join(", ")}`);
  console.log(`发送 ${signal} 信号...`);

  let killed = 0;
  for (const pid of allPids) {
    if (await killPid(pid, signal)) {
      killed++;
    }
  }

  if (signal === "SIGTERM") {
    await new Promise((r) => setTimeout(r, 1000));
    const remaining = new Set<number>();
    for (const pid of allPids) {
      try {
        process.kill(pid, 0);
        remaining.add(pid);
      } catch {
        // 进程已退出
      }
    }
    if (remaining.size > 0) {
      console.log(`仍有 ${remaining.size} 个进程未退出，发送 SIGKILL...`);
      for (const pid of remaining) {
        await killPid(pid, "SIGKILL");
      }
    }
  }

  console.log(`已终止 ${killed} 个进程`);
}

main();