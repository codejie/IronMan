# IronMan 实施规划

## 目标与边界

IronMan 复刻 [Batman](https://github.com/codejie/Batman) 的投资分析闭环，并改进认证、数据源容错、数据导出、任务可靠性和日常操作体验。功能依据 [项目分析报告](project-replication-guide.md)，工程约束以 [AGENTS.md](../AGENTS.md) 为准。

后端与前端必须分别位于 `backend/`、`frontend/`，以 Bun 和 TypeScript 构建。根目录可使用 Bun workspace 管理共享脚本和 OpenAPI 生成物，但两端必须可独立构建、测试和部署。

## 架构决策

| 领域 | 方案 | 落地规则 |
| --- | --- | --- |
| 后端 | Hono、Zod 与 OpenAPI | 业务接口使用 `POST` 和 JSON body；生成 `openapi.json`；仅 SSE、WebSocket、下载等例外使用其他方法。 |
| 前端 | Vue 3、Vite、TypeScript | 风格和交互密度参考 sub2api 管理后台；客户端由 OpenAPI 生成，避免手写契约漂移。 |
| 响应契约 | `IRequest` / `IResponse<T>` | 成功统一为 `code: 0`；错误也返回可读 `message` 与稳定错误码。 |
| 数据库 | SQLite + `bun:sqlite` | 数据库路径由 `DATABASE_PATH` 注入；启动时执行迁移、`foreign_keys=ON`、WAL 和 `busy_timeout`。 |
| 多用户 | 行级隔离 | 每张用户业务表必须有非空 `user_id`；服务层从会话取得用户，不接受客户端传入的所有者 ID。 |
| 数据源 | 可切换适配层 | Tencent、AkShare 或其他免费稳定来源实现同一适配接口；配置指定主源和回退源，统一字段、缓存和失败语义。 |
| 指标 | TA-Lib 能力适配层 | 优先选择 Bun 可运行的 TA-Lib/WASM 方案；用固定行情样本对 MA、MACD、RSI、BOLL 等结果做对照测试。 |

## 接口契约

所有业务接口的请求和响应以以下定义为基础。每个 OpenAPI operation 必须声明请求 body、成功结果和业务错误；前端客户端只能根据生成的契约调用接口。

```typescript
declare interface IRequest {}

declare interface IResponse<T = any> {
  code: number
  message?: string
  result: T extends any ? T : T & any
}
```

SQLite 是唯一关系型数据库。Docker Compose 只编排 `frontend` 和单个 `backend`；将 `ironman.sqlite`、`-wal`、`-shm`、备份文件挂载至 `IRONMAN_DATA_DIR`。首期后端固定为单实例，定时执行器在数据库中保存锁、幂等键、状态和重试记录，避免重复触发。用户表以外的行情基础数据可共享；自选、持仓、交易、策略、任务、告警、笔记、配置和导入导出记录必须按用户隔离。

## 目标结构

```text
backend/                 OpenAPI、认证、SQLite、数据源、指标、任务与告警
frontend/                Vue 应用、菜单路由、页面、图表与生成的 API 客户端
packages/api-contract/   OpenAPI 文档、生成配置与共享契约（可选）
deploy/                  Dockerfile、Compose、反向代理和环境变量示例
docs/                    规划、菜单、接口与验收记录
```

## 主要功能清单

| 功能域 | 主要能力 | 阶段 |
| --- | --- | --- |
| 账户与安全 | 注册/登录、会话续期、个人资料、密码管理、管理员用户管理与审计 | P0 |
| 平台基础 | OpenAPI、统一响应、错误处理、迁移、Docker、健康检查、日志与备份 | P0 |
| 标的与行情 | 股票/指数/基金标的库、历史与实时行情、数据源切换、缓存与数据质量状态 | P1 |
| 自选与资产 | 自选、备注、目标价、排序、持仓、买卖/分红、资金与交易流水、收益图 | P1 |
| 图表与指标 | K 线、成交量、MA、MACD、RSI、BOLL 等指标及其参数展示 | P1 |
| 策略分析 | 分析方案、标的范围、指标参数、趋势任务、SSE 进度、聚合报告 | P2 |
| 自动化 | 定时任务、执行队列、幂等执行、失败重试、运行记录 | P2 |
| 提醒告警 | 价格/指标/任务规则、去重、通知渠道、触发历史与确认状态 | P2 |
| 内容与扩展 | 市场云图、三方榜单、资讯链接、投资笔记、完整导入导出 | P3 |
| 智能与实时 | AI 咨询、工具调用与图表结果、实时行情推送 | P3 |

## 分期与验收

### P0：可运行的多用户平台

完成工程骨架、登录、用户隔离、迁移、OpenAPI、SQLite 卷持久化和 Docker Compose。验收包括：两个用户无法读取或修改对方数据；容器重启后数据与迁移版本保留；所有常规接口只接受 `POST` body 且响应满足 `IResponse`。

### P1：投资工作台最小闭环

完成标的初始化、数据源配置、自选、行情图、持仓与资金流水、基础指标和仪表盘。验收包括：在数据源不可用时切换或清楚提示；买卖在一个事务内更新持仓与资金；同一用户可从标的检索完成自选和持仓记录。

### P2：策略、定时和告警

完成策略编辑、趋势计算、SSE 报告、定时任务、提醒规则、通知记录和失败重试。验收包括：任务重启后可恢复或标记失败；幂等键不会重复发出同一告警；仅任务所属用户可查询任务或 SSE 流。

### P3：扩展能力与体验完善

完成榜单、资讯、笔记、完整备份恢复、AI 咨询和实时推送。验收包括：导出覆盖用户全部私有数据；AI 工具调用遵从用户隔离；前端在桌面和移动端均可完成高频资产操作。

## TDD 与质量门槛

每项功能先提交验收用例，再实现代码。纯单元测试使用 fixture，不访问外部行情；数据源适配层另设显式网络集成测试。每期必须通过：请求/响应契约测试、SQLite 迁移测试、用户隔离集成测试、关键页面端到端测试、Docker Compose 冒烟测试。失败路径要覆盖无效输入、无权限访问、数据源超时、重复任务和容器重启。
