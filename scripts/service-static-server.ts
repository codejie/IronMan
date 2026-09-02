import { normalize, resolve, sep } from "node:path";
import { configuredHost, configuredPort, connectionHost, projectRoot } from "./service-runtime";

const staticDirectory = resolve(projectRoot, "frontend", "dist");
const frontendHost = configuredHost(process.env.IRONMAN_FRONTEND_HOST, "IRONMAN_FRONTEND_HOST", "127.0.0.1");
const frontendPort = configuredPort(process.env.IRONMAN_FRONTEND_PORT, "IRONMAN_FRONTEND_PORT", 6100);
const backendHost = connectionHost(configuredHost(process.env.IRONMAN_BACKEND_HOST, "IRONMAN_BACKEND_HOST", "127.0.0.1"));
const backendPort = configuredPort(process.env.IRONMAN_BACKEND_PORT, "IRONMAN_BACKEND_PORT", 6101);

const server = Bun.serve({
  hostname: frontendHost,
  port: frontendPort,
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/openapi.json" || url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return proxyToBackend(request, url);
    }

    const requestedFile = fileForPath(url.pathname);
    if (requestedFile !== null) {
      const file = Bun.file(requestedFile);
      if (await file.exists()) return new Response(file);
    }

    return new Response(Bun.file(resolve(staticDirectory, "index.html")));
  },
});

console.info(`IronMan frontend static server listening on http://${frontendHost}:${server.port}`);

function fileForPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = normalize(decoded).replace(/^[/\\]+/, "");
  const candidate = resolve(staticDirectory, relativePath);
  return candidate === staticDirectory || candidate.startsWith(`${staticDirectory}${sep}`) ? candidate : null;
}

async function proxyToBackend(request: Request, sourceUrl: URL): Promise<Response> {
  const target = new URL(sourceUrl);
  target.protocol = "http:";
  target.hostname = backendHost.replace(/^\[|\]$/g, "");
  target.port = String(backendPort);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  try {
    return await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    });
  } catch {
    return Response.json({ code: 502, message: "后端服务不可用", result: null }, { status: 502 });
  }
}

function shutdown(): void {
  server.stop(true);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
