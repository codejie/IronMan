# IronMan

IronMan 是一个多用户的投资分析工作台，目标是复刻并改进 [Batman](https://github.com/codejie/Batman)。实施范围与菜单见 [docs/implementation-plan.md](docs/implementation-plan.md) 和 [docs/frontend-menu.md](docs/frontend-menu.md)。

## 本地开发

需要 Bun 1.3 或更高版本。

```bash
bun install
bun run dev:backend
bun run dev:frontend
```

前端默认地址为 `http://localhost:5173`，后端 OpenAPI 为 `http://localhost:3000/openapi.json`。开发环境 SQLite 默认写入 `data/ironman.sqlite`；生产环境必须设置强随机 `JWT_SECRET`。

## 测试与构建

```bash
bun run test
bun run lint
bun run build
```

## Docker

```bash
cp .env.example .env
# 编辑 .env，替换 JWT_SECRET
docker compose up --build
```

访问 `http://localhost:8080`。Compose 只运行前端与单个后端实例，SQLite 数据、WAL 文件和备份目录均由 `IRONMAN_DATA_DIR` 持久化。
