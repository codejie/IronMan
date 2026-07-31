# AKShareProvider 设计

## 目标

为 IronMan 增加本地运行的 Python 行情适配服务，供 TypeScript backend 通过 HTTP 调用。服务仅支持股票、指数和 ETF 的历史行情与现货行情，不保存用户、持仓或行情缓存数据。

## 边界

- Provider 默认按根目录 `.env` 中的 `AKSHARE_PROVIDER_HOST` 与 `AKSHARE_PROVIDER_PORT` 监听，即 `127.0.0.1:6102`。
- Provider 不提供任意 AkShare 函数透传；只暴露 `/health`、`/v1/market/history` 和 `/v1/market/spot`。
- backend 负责用户隔离、`market_bars` 缓存、数据源优先级、错误转换与回退。
- `fund` 请求使用 ETF 专用 AkShare 接口；开放式基金不在本期范围内。

## 合约

`POST /v1/market/history` 接收 `assetType`、`exchange`、`code`、`timeframe`、`limit`、`endDate` 和 `adjust`，返回统一的 `bars`：`date/open/close/high/low/volume`。

函数映射：

- `stock` -> `stock_zh_a_hist`
- `index` -> `index_zh_a_hist`
- `fund` -> `fund_etf_hist_em`

## 运行与隔离

- Python 版本由 `AKSHARE_PYTHON` 指定，默认优先 `python3.13`，回退 `python3`。
- `bun run akshare:setup` 在 `akshare-provider/.venv` 创建虚拟环境并安装固定依赖。
- 根目录的 backend 启动脚本会和 Provider 一起启动；Provider 缺失时给出明确的 setup 指引。
- `AKSHARE_PROVIDER_URL` 可改为已运行的本地服务地址，backend 保持回退现有数据源的行为。

## 验收

1. Python 归一化测试覆盖股票、指数、ETF 三种函数映射和无效数据拒绝。
2. TypeScript Provider 测试覆盖 HTTP 请求参数、响应转换、非 2xx 和无效响应。
3. `akshare` 可在用户的数据源配置中作为首选或备用源。
4. Provider 不可用时，`MarketService` 继续尝试腾讯、东方财富或 mock fallback。
