FROM oven/bun:1.3.14 AS build

WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile

COPY backend backend
RUN bun run --cwd backend build

FROM oven/bun:1.3.14

WORKDIR /app
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN bun install --frozen-lockfile --production

COPY --from=build /app/backend/dist backend/dist
RUN mkdir -p /app/data

ENV IRONMAN_BACKEND_HOST=0.0.0.0
ENV IRONMAN_BACKEND_PORT=6101
ENV DATABASE_PATH=/app/data/ironman.sqlite
EXPOSE 6101
CMD ["bun", "backend/dist/server.js"]
