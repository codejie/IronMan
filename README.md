# IronMan

IronMan 是一个多用户的投资分析工作台，目标是复刻并改进 [Batman](https://github.com/codejie/Batman)。实施范围与菜单见 [docs/implementation-plan.md](docs/implementation-plan.md) 和 [docs/frontend-menu.md](docs/frontend-menu.md)。

## 本地开发

需要 Bun 1.3 或更高版本。启用 AkShare 本地行情源时还需要 Python 3.11+；`akshare:setup` 默认优先使用本机 `python3.13`。

```bash
bun install
bun run akshare:setup
bun run dev:backend
bun run dev:frontend
```

应用的主机与端口统一在根目录 [`.env`](.env.example) 中配置：默认前端为 `http://127.0.0.1:6100`，后端 OpenAPI 为 `http://127.0.0.1:6101/openapi.json`，AKShareProvider 为 `http://127.0.0.1:6102`。开发环境 SQLite 默认写入 `data/ironman.sqlite`；生产环境必须设置强随机 `JWT_SECRET`。

`bun run dev:backend` 会先按 `.env` 中的 `AKSHARE_PROVIDER_HOST` 与 `AKSHARE_PROVIDER_PORT` 启动隔离的 AKShareProvider，再启动 Bun backend。Provider 只供 backend 内部调用；在“系统配置 > 行情与日历”中选择“AkShare 本地服务”即可使用。设置 `AKSHARE_PROVIDER_AUTOSTART=false` 可改为连接已运行的 Provider；如需指定完整地址，可设置 `AKSHARE_PROVIDER_URL` 覆盖主机与端口配置。

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

访问 `http://127.0.0.1:6100`。Compose 只运行前端与单个后端实例，SQLite 数据、WAL 文件和备份目录均由 `IRONMAN_DATA_DIR` 持久化。
