FROM oven/bun:1.3.14 AS build

WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile

COPY backend backend
COPY frontend frontend
COPY scripts scripts
RUN bun run --cwd backend build
RUN bun run --cwd frontend build

FROM oven/bun:1.3.14

WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --production

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
COPY --from=build /app/scripts/service-runtime.ts scripts/service-runtime.ts
COPY --from=build /app/scripts/service-static-server.ts scripts/service-static-server.ts
COPY --from=build /app/scripts/container-entrypoint.ts scripts/container-entrypoint.ts
RUN mkdir -p /app/data

ENV IRONMAN_BACKEND_HOST=0.0.0.0
ENV IRONMAN_BACKEND_PORT=6101
ENV IRONMAN_FRONTEND_HOST=0.0.0.0
ENV IRONMAN_FRONTEND_PORT=6100
ENV DATABASE_PATH=/app/data/ironman.sqlite
ENV AKSHARE_PROVIDER_AUTOSTART=false

EXPOSE 6100
ENTRYPOINT ["bun", "/app/scripts/container-entrypoint.ts"]
