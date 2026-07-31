import { loadRuntimeConfig, loadServerConfig } from "./config";
import { createApp } from "./app";

const config = loadRuntimeConfig();
const serverConfig = loadServerConfig();
const runtime = createApp(config);
runtime.startScheduler();

const server = Bun.serve({
  fetch: runtime.app.fetch,
  hostname: serverConfig.host,
  port: serverConfig.port,
});

console.info(`IronMan backend listening on http://${serverConfig.host}:${server.port}`);

function shutdown(): void {
  server.stop();
  runtime.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
