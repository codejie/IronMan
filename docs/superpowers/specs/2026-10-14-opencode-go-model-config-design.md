# OpenCode Go 模型配置接入设计

> 日期：2026-10-14 ｜ 状态：已评审，待实现

## 目标

在 IronMan 的 AI 咨询配置中新增独立服务商 `opencode_go`（OpenCode Go），并在设置页支持拉取 OpenCode Go 实时模型目录。OpenCode Go 是 OpenAI 兼容网关：`https://opencode.ai/zen/go/v1`，API Key 在 OpenCode Console 订阅获取（必填）。

## 范围

- 后端：服务商枚举扩展（含一处重复枚举）、`trend_run_report_interpretations.provider` 的 CHECK 约束迁移、模型目录拉取路由（服务端 fetch + TTL 缓存 + zod 校验）。
- 前端：AI 配置弹窗服务商选项、切换时自动填充 BaseUrl/默认模型、「获取模型列表」按钮与候选填充、聊天页来源标签。
- 共用同一份 AI 配置的趋势解读、持仓诊断、AI 候选自动获得该服务商。

不做：端点兼容性过滤、免费标记、Key 连通性测试、默认系统提示文案调整。

## 设计要点

### 1. 服务商枚举触点

| 位置 | 改动 |
| --- | --- |
| `backend/src/app.ts` `aiProviderSchema` | 增加 `opencode_go` |
| `backend/src/app.ts` 趋势解读路由重复枚举 | 同步增加 |
| `backend/src/services/assistant-service.ts` `AiProvider` 与 `providerNames` | 增加 `opencode_go` |
| `frontend/src/api/client.ts` `AiProvider` | 增加 `opencode_go` |
| `frontend/src/views/SystemConfigurationView.vue` `providerOptions` 与切换预设 | 增加选项与自动填充 |
| `frontend/src/views/AiConsultationView.vue` `providerLabel` | 增加标签 |

API Key 必填：`normalizeModel` 的默认校验（非 Ollama 必填）与远端门禁天然覆盖。

### 2. 数据库迁移

`trend_run_report_interpretations.provider` 存在 CHECK 约束（仅允许 `local/deepseek/ollama/openai_compatible`）。新增迁移：重建该表加入 `opencode_go`（create-copy-drop-rename，恢复原有索引）。

### 3. 模型目录拉取

- 新路由 `POST /api/settings/ai/opencode-go/models`（登录态、空 body），服务端 fetch `https://opencode.ai/zen/go/v1/models`，5 秒超时，zod 校验，进程内 10 分钟 TTL 缓存（全局数据，不按用户、不落库）。
- 失败（超时/非 2xx/畸形）返回可读业务错误，不影响已有配置。
- 不按端点兼容性过滤；选中仅支持 `/responses` 或 `/messages` 的模型时沿用远端失败→本地回退。

### 4. 前端交互

- 服务商选 “OpenCode Go”：自动填 `https://opencode.ai/zen/go/v1` 与默认模型 `step-5-preview-free`（chat/completions 兼容、免费档）。
- 模型输入框旁「获取模型列表」按钮 → 调用新路由 → 候选列表 → 点击填入；保留自由输入。

## 验收

1. 后端测试：opencode_go 配置写入/读回；目录路由（成功、上游失败、畸形响应，mock fetch）；远端请求携带 Bearer Key；迁移后 CHECK 放行新 provider 的解读记录写入。
2. 前端测试：切换 OpenCode Go 自动填充；获取模型列表并填入；聊天页传 modelId。
3. `tsc --noEmit`（后端）与 `vue-tsc`（前端）零错误；既有用例不回退。
