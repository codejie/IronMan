import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const providerDirectory = resolve(root, "akshare-provider");
const virtualEnvironment = resolve(providerDirectory, ".venv");
const virtualPython = process.platform === "win32" ? resolve(virtualEnvironment, "Scripts", "python.exe") : resolve(virtualEnvironment, "bin", "python");
const requestedPython = process.env.AKSHARE_PYTHON;
const candidates = requestedPython === undefined ? ["python3.13", "python3"] : [requestedPython];

function commandExists(command: string): boolean {
  return Bun.spawnSync({ cmd: [command, "--version"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

function run(command: string, args: string[]): void {
  const result = Bun.spawnSync({ cmd: [command, ...args], cwd: providerDirectory, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

const python = candidates.find(commandExists);
if (python === undefined) {
  console.error(`未找到可用 Python。请设置 AKSHARE_PYTHON；已尝试：${candidates.join(", ")}`);
  process.exit(1);
}

if (!existsSync(virtualPython)) {
  console.info(`创建 AKShareProvider 虚拟环境：${virtualEnvironment}`);
  run(python, ["-m", "venv", virtualEnvironment]);
}

console.info(`使用 ${virtualPython} 安装隔离依赖`);
run(virtualPython, ["-m", "pip", "install", "--upgrade", "pip"]);
run(virtualPython, ["-m", "pip", "install", "-r", "requirements.txt"]);
console.info("AKShareProvider 初始化完成。");
