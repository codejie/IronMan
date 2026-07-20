# Repository Guidelines

## 项目目标

本工程的版本库为 [codejie/IronMan](https://github.com/codejie/IronMan)，目标是复刻 [codejie/Batman](https://github.com/codejie/Batman) 的核心能力，功能分析以 `docs/project-replication-guide.md` 为准。复刻不是逐字迁移：实现相同业务闭环的同时，应修复原工程中可能存在的认证、数据源稳定性、路由拼写、导出范围、任务可靠性和交互体验问题，优先做成更实用、更方便、更顺畅的产品。

## 架构与目录

保持前后端分离构建，分别建立 `backend/` 与 `frontend/` 应用。统一使用 Bun 构建与管理脚本，语言使用 TypeScript。后端负责 OpenAPI 接口、数据源适配、用户隔离、任务调度、告警提醒和指标计算；前端负责登录、资产管理、行情图表、策略分析、提醒配置和系统设置。文档、设计和验收记录放入 `docs/`。工程必须支持 Docker 部署：为各应用提供可复现的镜像构建，并用 Compose 或等价方案编排运行依赖；配置通过环境变量注入，持久化数据使用卷且不写入镜像。

## 接口与数据契约

接口遵循 OpenAPI 标准。除特殊场景外，接口只使用 `POST`，请求参数放在 body 中；SSE、WebSocket、文件下载等确有需要时可使用更合适的方法。请求和响应类型以此为基础：

```typescript
declare interface IRequest {}

declare interface IResponse<T = any> {
  code: number
  message?: string
  result: T extends any ? T : T & any
}
```

类型定义、常量和枚举不必机械照搬 Batman，可按新的技术方案调整，但必须保持语义清晰、前后端一致并有测试覆盖。

## 数据源与指标

Batman 使用 AkShare 和 Tencent 服务获取行情数据。本工程允许选择或增加其他免费、稳定的数据渠道，但必须通过数据源适配层统一字段、错误处理和缓存策略。存在多个渠道时，必须提供配置切换功能。指标能力需要覆盖 TA-Lib 相关功能，可选用 TypeScript 可用库、WASM、服务封装或等价实现。

## 多用户、任务与告警

工程必须支持多用户。所有持仓、自选、笔记、策略、告警、任务、配置和导入导出数据都要按用户隔离，禁止依赖全局默认用户。新增支持提醒/告警与定时执行：包括规则配置、触发记录、任务状态、失败重试和可观测日志。

## 前端体验

前端风格、样式和布局参考 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) 及其后台示例 [sub2api-admin](https://sub2api-admin.enlhz.com/dashboard)。面向高频使用场景设计：导航清晰、表格密度合理、配置流程顺畅、图表信息可读，避免只做展示型页面。

## 开发、测试与验收

先规划方案，再进入实现。遵循 TDD：先写或明确验收用例，再实现功能。每个模块至少覆盖成功路径、权限隔离、异常输入和外部服务失败。常用脚本应以 Bun 暴露，例如 `bun test`、`bun run dev`、`bun run build`、`bun run lint`。

## 提交与安全

提交信息使用清晰的祈使句或约定式提交，例如 `feat: add alert scheduler`。PR 需说明功能范围、接口变化、测试结果和截图。不得提交 API Key、本地数据库、行情缓存或用户导出数据。
