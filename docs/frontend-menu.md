# IronMan 前端菜单与路由（实现现状）

> 本文档按 `frontend/src/` 实际代码编写（2026-10-14 核对），描述当前已落地的菜单、路由、守卫、API 层与交互规范。历史规划版菜单（`/assets/watchlist`、`/market/instruments`、`/automation/schedules` 等路径体系）未采用，实现沿用 Batman 遗留路径风格；规划与实现的差异见第 7 节。
>
> 涉及后端能力时，以 `backend/src/app.ts` 的路由表为准；本文前端路径与后端接口的对应关系已经双向核对（123 个静态路径 + 3 个 SSE 路径全部一致）。

## 1. 技术栈

| 领域 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | Vue 3 + TypeScript + Vite | 单页应用，hash 路由（`createWebHashHistory`），URL 形如 `/#/holding/list` |
| 路由 | Vue Router 4 | 静态路由表 + `beforeEach` 认证守卫；菜单为前端固定配置，无后端动态菜单接口 |
| 图表 | ECharts | K 线、持仓收益、资金趋势、趋势报告聚合图 |
| 图标 | lucide-vue-next | 侧边菜单与操作图标 |
| 请求 | 原生 `fetch` 封装 | `frontend/src/api/client.ts` 单文件承载全部接口，未使用 axios |
| 会话 | 模块级 ref + localStorage | `frontend/src/stores/session.ts`，存储键 `ironman.session`，未使用 pinia |
| 测试 | Vitest | 覆盖菜单、日期格式化、通用组件与各页展示逻辑（如 `menu.test.ts`、`HoldingsView.test.ts`） |

## 2. 路由总览

除 `/login` 外全部业务路由挂在 `AppShell`（布局 + 侧边菜单）下。`/` 重定向到 `/holding/list`；未匹配路径统一回退 `/holding/list`。

| 路径 | 视图组件 | 页面标题 | 进入方式 |
| --- | --- | --- | --- |
| `/login` | `views/LoginView.vue` | 登录 | 公开页（`meta.public`） |
| `customized/list` | `views/WatchlistView.vue` | 自选列表 | 侧边菜单 |
| `holding/list` | `views/HoldingsView.vue` | 持仓信息 | 侧边菜单；首页默认落地页 |
| `holding/detail` | `views/HoldingDetailView.vue` | 持仓详情 | 持仓列表跳转，经 query 携带（`?id=`、`ids=`） |
| `holding/funds/trend` | `views/FundsTrendView.vue` | 资金趋势 | 持仓信息页内跳转 |
| `analysis/trend/strategy/new` | `views/TrendStrategyEditorView.vue` | 新建趋势策略 | 趋势计算页跳转 |
| `analysis/trend/strategy/:id` | `views/TrendStrategyEditorView.vue` | 编辑趋势策略 | 趋势计算页跳转 |
| `analysis/trend` | `views/TrendAnalysisView.vue` | 趋势计算 | 侧边菜单（数据分析组） |
| `analysis/holding-diagnosis` | `views/HoldingDiagnosisView.vue` | 持仓诊断 | 侧边菜单（数据分析组） |
| `analysis/ai-candidates` | `views/AiCandidatesView.vue` | AI候选 | 侧边菜单（数据分析组） |
| `analysis/ai-candidates/evaluation` | `views/AiCandidateEvaluationView.vue` | AI候选效果评估 | AI候选页内跳转 |
| `analysis/agent` | `views/AiConsultationView.vue` | AI咨询 | 侧边菜单（数据分析组） |
| `automation/alerts` | `views/AlertCenterView.vue` | 提醒 | AppShell 侧边栏快捷图标（铃铛），不在主菜单列表中 |
| `data/third/technical-data` | `views/third/ThirdTechnicalDataView.vue` | 技术数据 | 侧边菜单（三方数据组） |
| `data/third/info-links` | `views/third/ThirdInfoLinksView.vue` | 资讯链接 | 侧边菜单（三方数据组） |
| `data/third/market-cloud` | `views/third/ThirdMarketCloudView.vue` | 大盘云图 | 侧边菜单（三方数据组） |
| `notes/leek-notes` | `views/LeekNotesView.vue` | 韭菜笔记 | 侧边菜单 |
| `system/configuration` | `views/SystemConfigurationView.vue` | 系统配置 | 侧边菜单 |
| `settings/profile` | `views/BatmanPlaceholderView.vue` | 用户 | 占位页；已登录用户访问 `/login` 时守卫重定向到此 |
| `sytem/configuration` | — | — | 历史拼写兼容：重定向到 `/system/configuration` |
| `/:pathMatch(.*)*` | — | — | 兜底：重定向到 `/holding/list` |

## 3. 侧边菜单结构

菜单由 `frontend/src/navigation/menu.ts` 定义、`components/AppShell.vue` 渲染，当前为固定菜单，**不按角色区分**（后端有 `admin` 角色与 `/api/admin/*` 接口，前端暂无对应页面）。

| 分组 | 菜单项 | 路径 |
| --- | --- | --- |
| （顶级） | 自选列表 | `/customized/list` |
| （顶级） | 持仓信息 | `/holding/list` |
| 数据分析 | 趋势计算 | `/analysis/trend` |
| 数据分析 | 持仓诊断 | `/analysis/holding-diagnosis` |
| 数据分析 | AI候选 | `/analysis/ai-candidates` |
| 数据分析 | AI咨询 | `/analysis/agent` |
| 三方数据 | 技术数据 | `/data/third/technical-data` |
| 三方数据 | 资讯链接 | `/data/third/info-links` |
| 三方数据 | 大盘云图 | `/data/third/market-cloud` |
| （顶级） | 韭菜笔记 | `/notes/leek-notes` |
| （顶级） | 系统配置 | `/system/configuration` |

菜单之外的快捷入口：AppShell 侧边操作区的“提醒”图标（`/automation/alerts`）与“用户”下拉（`/settings/profile`）。

## 4. 认证守卫

`router/index.ts` 的 `beforeEach` 逻辑：

1. 目标路由 `meta.public === true`（仅 `/login`）：未登录放行；已登录则重定向到 `/settings/profile`。
2. 其余路由：调用 `useSession().validate()`（内部请求 `/api/account/me`），失败或未登录重定向到 `/login`。
3. `afterEach` 将 `meta.title` 写入 `document.title`（格式 `标题 | IronMan`）。

注意：守卫在**每次**非公开导航时都会请求一次 `/api/account/me`，未做本地缓存。

## 5. API 层

`frontend/src/api/client.ts`（单文件，约 1640 行）：

- **请求封装**：原生 `fetch` 的 `post<T>(path, body, token)`；基础地址 `import.meta.env.VITE_API_BASE_URL ?? "/api"`。
- **认证**：请求头 `authorization: Bearer <token>`（注意：早期文档中的 `x-token` 是 Batman 原工程的写法，IronMan 未采用）。
- **响应契约**：`{ code, message?, result }`，仅 `code === 0` 视为成功，否则抛出 `ApiError`（携带 `code` 与 `message`）。
- **接口分组**：auth、account、admin、market、settings、analysis（indicators/strategies/tasks/trend/holding-diagnosis/ai-candidates）、assets（watchlist/cash/funds/holdings）、automation（schedules/alerts）、notes、assistant、third-party，以及数据导出/导入。
- **导出下载**：`api.exportData` 返回 JSON，由 `SystemConfigurationView` 转 Blob 后触发浏览器下载（`ironman-export-YYYY-MM-DD.json`），后端无专用文件下载接口。
- **SSE**（3 个 `EventSource` 工厂，token 经 query 传递，与后端 `?token=` 约定一致）：
  - `streamWatchlist` → `GET /api/stream/watchlist`（自选行情快照，约 15 秒一轮，最多 120 次）
  - `streamTrendRun` → `GET /api/analysis/trend/runs/:id/events`（趋势运行事件）
  - `streamTask` → `GET /api/stream/tasks/:taskId`（旧任务流，当前无调用方）
- **事件名**（已与后端核对）：趋势流为 `snapshot / progress / report / log / completed / failed / cancelled`，自选流为 `snapshot`，断线由 `error` 事件处理。
- 未使用 WebSocket（Batman 原工程的 `/ws/spot_data` 未复刻，由 SSE 轮询替代）。

## 6. 交互反馈规范（对应 AGENTS.md）

- 禁止浏览器原生 `alert/confirm/prompt`：确认动作统一走 `components/confirmation.ts` 的 `requestConfirmation()`，由 `App.vue` 挂载的全局 `components/AppConfirmDialog.vue` 渲染（删除、清仓、覆盖导入等场景已在用）。
- 页面错误采用页内 `errorMessage` 展示，不使用全局弹窗。
- 快速创建提醒规则使用 `components/QuickAlertDialog.vue`（持仓页入口）。

## 7. 与历史规划的差异（重要）

| 历史规划（docs/frontend-menu.md 初版、implementation-plan.md） | 实际实现 | 说明 |
| --- | --- | --- |
| `/assets/watchlist`、`/assets/holdings`、`/market/instruments`、`/analysis/charts`、`/automation/schedules` 等路径体系 | `/customized/list`、`/holding/list` 等 Batman 遗留路径 | 实现选择延续 Batman 结构，规划路径未采用 |
| `/dashboard` 资产驾驶舱 | 无对应页面 | 个人理财增强方案中的“总览”未实施 |
| `/admin/users`、`/admin/audit-logs`、`/admin/system` 前端管理页 | 无前端页面（后端接口已具备） | 目前仅能通过接口层使用管理员能力 |
| 按角色区分的动态菜单 | 固定菜单，无角色区分 | 后端 `admin` 角色已生效，前端未做菜单级区分 |
| K 线独立页面 `/analysis/charts` | K 线以弹窗形式存在于自选/持仓/榜单页 | 未提供独立图表页 |
| `/settings/profile` 个人与安全 | `BatmanPlaceholderView` 占位 | 功能未实现 |

## 8. 环境与运行

- 开发端口统一在根目录 `.env`：前端 `127.0.0.1:6100`，后端 `127.0.0.1:6101`（`IRONMAN_FRONTEND_*` / `IRONMAN_BACKEND_*`）。
- Vite 开发代理把 `/api` 与 `/openapi.json` 转发到后端；`VITE_PROXY_TARGET` 可显式覆盖代理目标。
- 常用脚本：`bun run dev:frontend`、`bun run build`（含 `vue-tsc` 类型检查）、`bun run lint`、`bun run test`。
