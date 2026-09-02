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

## 本地生产服务

本地生产模式直接运行已构建的 `backend/dist` 与 `frontend/dist`，前端静态服务会将 `/api` 和 `/openapi.json` 代理到后端。它不使用 Vite 开发服务器。

```bash
bun run service:build
bun run service:start
bun run service:stop
```

启动脚本会在 `.ironman/service/` 写入仅属于当前项目的 PID 清单和日志；停止脚本只终止清单中的受管进程。生产环境需要在 `.env` 中配置至少 24 位的 `JWT_SECRET`。

## Docker

```bash
cp .env.example .env
# 编辑 .env，替换 JWT_SECRET
bun run docker:build
bun run docker:start
# 停止容器
bun run docker:stop
```

`docker:build` 使用 Buildx 构建 `linux/arm64` 单镜像，镜像同时包含 backend 与 frontend 的构建产物；`docker:start` 使用 `docker compose up -d --no-build` 启动该镜像。容器内部由前端静态服务代理 `/api` 到后端，Compose 只将前端端口 `6100` 暴露到宿主机，因此访问 `http://127.0.0.1:6100` 即可。默认宿主机目录 `./data` 会绑定到容器 `/app/data`，数据库文件为 `./data/ironman.sqlite`；设置 `IRONMAN_DATA_DIR` 可改用其他宿主机目录，SQLite 的 `-wal`、`-shm` 和备份文件也会保留在该目录中，更新镜像或重建容器不会丢失数据。容器默认关闭 AKShareProvider 自动启动，可通过 `AKSHARE_PROVIDER_URL` 连接外部行情服务。
