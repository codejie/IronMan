import { setTimeout } from "node:timers/promises";
import { isManagedProcessRunning, readManifest, removeManifest, type ServiceProcess } from "./service-runtime";

const manifest = readManifest();
if (manifest === null) {
  console.info("未找到受本脚本管理的 IronMan 生产服务");
  process.exit(0);
}

const running = [] as ServiceProcess[];
for (const entry of manifest.processes) {
  if (await isManagedProcessRunning(entry)) running.push(entry);
}

for (const entry of [...running].reverse()) {
  process.kill(entry.pid, "SIGTERM");
}

await setTimeout(1_000);
const remaining = [] as ServiceProcess[];
for (const entry of running) {
  if (await isManagedProcessRunning(entry)) remaining.push(entry);
}

for (const entry of remaining) {
  process.kill(entry.pid, "SIGKILL");
}

removeManifest();
console.info(`已停止 ${running.length} 个 IronMan 生产服务进程`);
