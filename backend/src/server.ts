import { loadRuntimeConfig } from "./config";
import { createApp } from "./app";

const config = loadRuntimeConfig();
const runtime = createApp(config);
runtime.startScheduler();
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  fetch: runtime.app.fetch,
  port
});

console.info(`IronMan backend listening on http://localhost:${server.port}`);

function shutdown(): void {
  server.stop();
  runtime.close();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
