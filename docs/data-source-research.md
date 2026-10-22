# 免费 A 股数据源调研报告（2026-10-22）

> 背景：系统行情 K 线默认主源为腾讯 `web.ifzq.gtimg.cn`，实测已被 WAF 全面拦截（HTTP 501 → waf.tencent.com 拦截页，更换浏览器 UA/Referer 无效），且 fallback 配置为 mock，导致行情不稳。本文记录实测结果与候选免费源的可用性，供数据源切换决策。
> 方法：对每个源发起真实 HTTP 请求实测（状态码/延迟/编码/字段结构/连续请求限频迹象），并核对其 JSON 字段与本系统 `MarketDataProvider` 契约的匹配度。

## 一、实测总表

| # | 源与端点 | 用途 | 实测 | 延迟 | 编码 | 备注 |
|---|---|---|---|---|---|---|
| 1 | 腾讯 `web.ifzq.gtimg.cn/appstock/app/fqkline/get`（**当前 primary**） | K 线 | ❌ **501 WAF 拦截** | — | — | 换浏览器 UA + Referer 仍拦，域名级封禁；本系统另请求 `data.10jqka.com.cn`（同花顺）也连带 WAF 401 时好时坏 |
| 2 | 腾讯 `proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get` | K 线 | ✅ 200 | 0.15s | UTF-8 JSON | **与现用端点同构**（`qfqday/qfqweek/qfqmonth`），日/周/月全通，近似零成本迁移 |
| 3 | 东财 `push2his.eastmoney.com/api/qt/stock/kline/get` | K 线 | ✅ 200 | 0.25s | UTF-8 JSON | 日(klt=101)/周(102)/月(103)，`fqt=1` 前复权，含当日盘中 bar、成交额、振幅；akshare/efinance 底层同源 |
| 4 | 东财 `push2.eastmoney.com/api/qt/ulist.np/get` | 实时报价批量 | ✅ 200 | 0.18s | UTF-8 JSON | 支持批量 secids；`f2/f3` 默认放大 100 倍（`fltt=2` 可得小数）；上游涨停池端点 push2ex 已在用且正常 |
| 5 | 东财 `datacenter-web.eastmoney.com/api/data/v1/get` | 榜单/数据中心 | ✅ 200 | 0.13s | UTF-8 JSON | `reportName` 制接口（实测龙虎榜 RPT_DAILYBILLBOARD_DETAILS），**同花顺创新高/连涨类榜单的替代首选** |
| 6 | 新浪 `money.finance.sina.com.cn/.../CN_MarketData.getKLineData` | K 线 | ✅ 200 | 0.12s | UTF-8 JSON | 股/ETF/指数全通；**不复权**、无成交额/换手、仅 5/15/30/60/240 分钟粒度（240=日线），无周/月 |
| 7 | 新浪 `hq.sinajs.cn/list=` | 实时报价 | ✅ 200 | 0.12s | **GBK** | 必须带 `Referer: finance.sina.com.cn`，否则拒绝；GBK（系统已有 charset 解码层） |
| 8 | 腾讯 `qt.gtimg.cn/q=` | 实时报价 | ✅ 200 | 0.17s | **GBK** | 一次可批量；`v_sh600000="1~浦发银行~600000~..."` 行情串 |
| 9 | 同花顺 `data.10jqka.com.cn` 排行页 | 榜单 | ❌/⚠️ | — | GBK | 真实页面 200（GBK），ajax 端点 WAF 401/403；外部资料证实 2026 年初同花顺侧反爬升级（akshare 的 `_ths` 接口同源受影响） |
| 10 | 本机 AKShare Provider（FastAPI，未运行） | 技术榜单/新闻/公告 | ⚠️ 未运行 | — | — | `AKSHARE_PROVIDER_AUTOSTART=false`，导致技术榜单降级到"同花顺直连（被拦）→ 本地持仓计算" |

## 二、候选源全景（2026 环境）

| 通道 | 类型 | 稳定性判断 | 结论 |
|---|---|---|---|
| 东方财富 push2/push2his/datacenter-web | HTTP 直连，无 key | **高**（JSON、UTF-8、无反爬特征码，实测无限频） | 推荐主源 |
| 腾讯 proxy.finance.qq.com（备用域名） | HTTP 直连，无 key | 高（现用域名被封但备用域名实测通） | 推荐次源 |
| 新浪 CN_MarketData / hq.sinajs.cn | HTTP 直连，无 key | 中（不复权、需 Referer、历史上有节奏限频） | 第三备源 |
| AKShare（聚合库） | 本地 Python 服务 | 中低（覆盖最广但上游反爬会传导） | 保留为可选聚合器 |
| Baostock | 本地 Python 库 | 高（自有协议、日线/复权因子/指数全），但仅日线及以下粒度 | 可选（并入既有 provider 进程） |
| Tushare Pro | HTTP + token（免费积分） | 高（需注册，行情基础数据） | 不必引入（东财直连已覆盖） |
| adata / Ashare 等轻量聚合库 | 本地 Python 库 | 中 | 不引入（本系统 TS 直连已更薄） |

## 三、与本系统契约的匹配度

`MarketDataProvider.history(instrument, timeframe, limit, endDate)` 需要 `{date, open, close, high, low, volume, amount?, turnoverRate?}`：

- **东财 push2his**：完全匹配（provider 已实现日/周/月、`fqt=1` 前复权、amount+turnoverRate）——现有 `backend/src/market/eastmoney-provider.ts` 无需改数据层。
- **腾讯 proxy.finance.qq.com newfqkline**：payload 与现用 `web.ifzq.gtimg.cn` 完全同构（`qfqday/qfqweek/qfqmonth` 数组），仅需把请求域名/路径换成备用域名（并可加主域名失败自动降级）。
- **新浪**：缺 `amount/turnoverRate` 且不复权，只能作为只看收盘价的最后兜底。

## 四、结论与建议

1. **立即可做（低风险，~20 行改动）**：
   - `tencent-provider.ts` 增加域名降级：先请求现用域名，遇 501/WAF 响应自动切 `proxy.finance.qq.com/ifzqgtimg/.../newfqkline/get`；
   - 系统配置默认值改为 `primary=eastmoney, fallback=tencent`（两个都是实测直连可用源）。
2. **mock 已移除（2026-10-22 实施）**：`本地模拟` 已从行情源配置中删去（`MarketSource` 类型、后端校验、前端选项、默认 fallback 均已调整），运行时不注册任何 mock provider，存量 `fallback=mock` 配置在读取时按字段净化为默认值。
2. **榜单链路**：同花顺侧（akshare `_ths` 接口与直连排行榜）反爬在持续收紧，不宜依赖；后续可用东财 `datacenter-web`（reportName 制）重做"创新高/连涨/量价齐升"榜单，此前该链路已有本地持仓计算兜底，短期可接受降级。
3. **无需** 引入 Tushare/Baostock/adata（东财直连已覆盖行情三粒度；Baostock 仅在需要复权因子与基本面补充时再评估）。
