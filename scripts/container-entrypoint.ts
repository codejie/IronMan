const appRoot = "/app";
const environment = {
  ...process.env,
  IRONMAN_BACKEND_HOST: process.env.IRONMAN_BACKEND_HOST ?? "0.0.0.0",
  IRONMAN_BACKEND_PORT: process.env.IRONMAN_BACKEND_PORT ?? "6101",
  IRONMAN_FRONTEND_HOST: process.env.IRONMAN_FRONTEND_HOST ?? "0.0.0.0",
  IRONMAN_FRONTEND_PORT: process.env.IRONMAN_FRONTEND_PORT ?? "6100",
  AKSHARE_PROVIDER_AUTOSTART: process.env.AKSHARE_PROVIDER_AUTOSTART ?? "false",
};

const backend = Bun.spawn({
  cmd: ["bun", "dist/server.js"],
  cwd: `${appRoot}/backend`,
  env: environment,
  stdout: "inherit",
  stderr: "inherit",
});
const frontend = Bun.spawn({
  cmd: ["bun", `${appRoot}/scripts/service-static-server.ts`],
  cwd: appRoot,
  env: environment,
  stdout: "inherit",
  stderr: "inherit",
});

let shuttingDown = false;
let receivedSignal = false;
function shutdown(signal: "SIGINT" | "SIGTERM"): void {
  if (shuttingDown) return;
  shuttingDown = true;
  backend.kill(signal);
  frontend.kill(signal);
}

process.once("SIGINT", () => {
  receivedSignal = true;
  shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  receivedSignal = true;
  shutdown("SIGTERM");
});

const firstExit = await Promise.race([
  backend.exited.then((code) => ({ code, name: "backend" })),
  frontend.exited.then((code) => ({ code, name: "frontend" })),
]);

shutdown("SIGTERM");
await Promise.all([backend.exited, frontend.exited]);

if (receivedSignal) process.exit(0);
console.error(`IronMan ${firstExit.name} process exited with code ${firstExit.code ?? 1}`);
process.exit(firstExit.code ?? 1);
