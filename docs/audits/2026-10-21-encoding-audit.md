# 编码问题审计记录（IronMan 全工程）

> 审计时间：2026-10-21
> 审计方式：只读静态扫描 + 运行时实测（容器 ironman@arm64 上健康运行，端口 6100）
> 审计范围：backend/、frontend/、scripts/、akshare-provider/（业务源码）、Dockerfile、运行库、HTTP 响应头、外部数据源
> 结论：**未发现编码问题**（所有检查面通过；2 项可选加固备忘，不影响现状）

## 一、检查面与结果

| # | 检查面 | 方法 | 结果 |
|---|---|---|---|
| 1 | 源文件编码 | Python 对全部源码/文档逐字节强制 UTF-8 解码 | 全部通过（0 失败）；无 BOM；无 CRLF；无混合换行 |
| 2 | 乱码痕迹 | 全树扫描 `锟斤拷`、`烫烫`、`U+FFFD`、`Ã¤`/`ä¸`/`æ‡` 等双编码错转特征 | 无 |
| 3 | 前端 HTML charset | `frontend/index.html` | `<meta charset="UTF-8" />`（第 4 行）✓ |
| 4 | HTTP 响应头 | curl 实测容器 6100 | 静态服务器返回 `text/html;charset=utf-8`、`text/javascript;charset=utf-8` ✓；后端 API `Content-Type: application/json`（无 charset，但 RFC 8259 规定 JSON 本身即 UTF-8，合规）|
| 5 | 数据库编码 | 容器内 `PRAGMA encoding` | `"UTF-8"` ✓；bun:sqlite 读写即 UTF-8，无中间转换层 |
| 6 | 外部数据源解码 | 逐个核对 provider 与实测响应头 | 腾讯：`web.ifzq.gtimg.cn/appstock/app/fqkline/get` JSON API（UTF-8），`response.json()` ✓，未使用 GBK 的 `qt.gtimg.cn` 文本端点；东方财富涨停池：JSON ✓；同花顺榜单：实测响应 `Content-Type: text/html;charset=utf-8`，`response.text()` 按 fetch 规范解码正确 ✓ |
| 7 | 导出/导入 | 检查 `SystemConfigurationView.vue` 导出下载与导入解析 | 前端本地 JSON 导出（Blob 默认 UTF-8）、JSON 解析导入 ✓；全工程无 CSV → 不存在 Excel 打开中文乱码问题 |
| 8 | 二进制/legacy 转换 | grep `toString('binary')`、`latin1`、`ISO-8859`、base64 | 无残留 |
| 9 | 显式文件 I/O 编码 | grep `readFileSync/writeFileSync/open()` | `scripts/service-runtime.ts:42` readFileSync 显式 `"utf8"` ✓；Python provider 无任何 `open()` 调用 ✓ |
| 10 | Docker 运行时 locale | 查看 Dockerfile | 纯 Bun 镜像（`oven/bun:1.3.14` 两阶段），镜像内无 Python → 无 locale 依赖的隐式编码路径；Python provider 仅跑在 macOS 宿主机（UTF-8 locale）✓ |

## 二、可选加固备忘（非问题，不影响现状）

1. **显式 encoding 缺省（整洁度）**
   - `scripts/service-runtime.ts:53`：`writeFileSync(manifestPath, ...)` 未显式传 encoding，但内容为纯 ASCII JSON + ISO 时间戳，Bun 默认即 UTF-8，行为正确。
   - `scripts/service-start.ts:57`：`writeFileSync(filePath, "")` 写空文件，同理无风险。
   - 建议：两处可补 `"utf8"` 参数，纯一致性收益。

2. **同花顺榜单解码的未来弹性**
   - `backend/src/services/third-party-data-service.ts:220` 是全工程唯一按文本流解码的外部端点（`parseThsRankingTable(await response.text())`）。
   - 实测该端点声明 `charset=utf-8`，当前解码正确。
   - 风险描述：若未来该端点改按 GBK 输出且/或不声明 charset，`response.text()` 将按 UTF-8 兜底解码 → 股票中文名乱码。
   - 建议：改为 `arrayBuffer()` + 按 Content-Type charset 参数选择 `TextDecoder` 编码（utf-8 缺省、gbk/gb18030 兜底）。
   - 附注：实测该端点当前返回 515 字节反爬占位页（与编码无关的可用性问题）。

## 三、复核说明

本记录供后续交叉验证使用：将交由 `harness-coding` agent 独立复核同一工程，对比其审计覆盖面与本记录差异，用于 agent 能力对比验证。

---

## 四、交叉验证（agent 能力对比）——2026-10-21 补录

### 4.1 复核设置

- 复核者：`harness-coding` agent（`~/.config/opencode/agents/harness-coding.md`，mode: primary），经 `opencode run --agent harness-coding --auto` 隔离会话运行，底层模型 `minimax-m3.1-flash-free`。
- 独立性控制：派发提示词未包含本记录任何结论，并明确要求"不要假设既有结论正确、按自己的判断确定检查面"。该 agent 在扫描中发现并阅读了本记录（untracked 文件），其报告附有独立性声明：仅将本记录作交叉参照，实测结论独立得出。
- 约束遵守：只读审计，工作区无修改、无 commit、容器未动 ✓。完整输出：`/tmp/opencode-harness-coding-audit.log`。

### 4.2 结论对比

| 维度 | 本记录（Claude） | harness-coding（minimax-m3.1-flash-free） | 判定 |
|---|---|---|---|
| 文件编码/BOM/换行 | 通过 | 通过 | 一致 |
| 乱码痕迹 | 通过 | 通过 | 一致 |
| HTTP/HTML charset | 通过 | 通过 | 一致 |
| SQLite 编码 | PRAGMA 查询，UTF-8 | PRAGMA + 全 TEXT 列扫描 | 一致（它更面） |
| 导出/导入 | 通过 | 通过 | 一致 |
| Docker/locale | 通过 | 通过（含 venv Python stdout 实测） | 一致（它更面） |
| **同花顺数据源解码** | **"实测 charset=utf-8，解码正确"** | **P1 实际缺陷：真实页面 `charset=gbk`，`response.text()` 按 WHATWG 规范强制 UTF-8 → 列名乱码** | **本记录误判，agent 正确** |

### 4.3 更正：同花顺结论由"备忘"升级为 P1 确证缺陷

本记录第 6 项中"同花顺榜单 charset=utf-8，解码正确"与备忘 2 的表述**是误判**，现更正如下：

- **误判机理**：我当时实测的是代码实际请求的 ajax 路径（`/rank/.../ajax/1/free/1/`），该请求被 WAF 以 401/403 拦截，返回 515 字节占位页且声明 `charset=utf-8`——据此得出"解码正确"的**假阴性**。同花顺数据中心全域（data./q./news.10jqka.com.cn）真实页面均为 GBK。
- **harness-coding 的验证**：用真实页面路径（如 `/rank/cxg/field/199112/order/desc/page/1/`）绕开 ajax WAF 得到 200：`Content-Type: text/html; charset=gbk`。
- **我方复验（独立确认，2026-10-21）**：实测同一路径 → `charset=gbk`，33745 字节；同一字节流，`response.text()` 产生 **1248 个 U+FFFD**、表头为 `["","Ʊ","Ʊ","ǵ",…]` 全部乱码；`TextDecoder("gbk")` 产生 **0 个 U+FFFD**、表头 `["序号","股票代码","股票简称",…]` 正确。另用本地固定 GBK 字节样本（`D0 F2 BA C5 = "序号"`）验证 Bun `Response.text()` 对 GBK 字节的强制 UTF-8 行为同型。
- **影响面**：`backend/src/services/third-party-data-service.ts:220`（`parseThsRankingTable(await response.text())`），连带 `:222-224` 按中文列名过滤的逻辑失配。当前该接口被 WAF 拦截走本地降级，乱码暂不可见；一旦放行即触发。akshare-provider（Python）路径不受影响（requests 按响应自动检测编码）。

### 4.4 能力对比观察

harness-coding 明显更强的方面：

1. **出站请求数点**：主动枚举并逐一实测了全部出站域名/端点（含 THS 多路径、多 UA、带 cookie 场景），而非像本记录那样只测代码里的单个 URL——这正是发现 P1 的方法学差异。
2. **端到端复现意识**：对可疑点构造字节级/脚本级复现（用 `Response(bytes).text()` 隔离网络变量验证 runtime 行为），而不是仅看响应头下结论。
3. **覆盖面更广**：额外做了 dist 构建产物扫描、运行日志乱码扫描、venv Python stdout 编码实测、`.gitattributes` 缺失（无换行/编码护栏）等检查面。

本记录相对优势的方面：检查结构化程度更高（逐项编号、方法列、结论列）；对外部端点的单点实测响应更快收敛（但恰恰因过早收敛而掉进假阴性陷阱）。

### 4.5 修订后的总体结论

- ~~未发现编码问题~~ → **发现 1 个确证缺陷（P1，同花顺 GBK 误解码）**，另有低风险项：P2 `holding-diagnosis-sources.ts:291` TextDecoder 固定 UTF-8（白名单域名现为 utf-8，暂无触发路径）、P3 `akshare-provider/.../service.py:223` `errors="ignore"` 静默丢字节、P4 两处 `writeFileSync` 建议显式 `"utf8"`、P5 外部 SQLite 未校验 PRAGMA encoding、P6 缺 `.gitattributes`/编码测试护栏。
- P1 修复建议（TDD）：先在 `backend/test/third-party-data.test.ts` 增加字节级 GBK 用例（现有测试只喂已解码字符串），再将 `third-party-data-service.ts:220` 改为 `arrayBuffer()` + 按 Content-Type charset 选择 `TextDecoder`（utf-8 缺省、gbk/gb18030 兜底），覆盖整域 GBK 场景。

---

## 五、修复记录（2026-10-21）

### 5.1 复现（先复现后修复）

- 复现脚本：`scripts/repro-encoding.ts`（纯本地、零网络依赖，注入字节级 GBK 响应走真实生产路径）
- 修复前输出：列名 `["���","��Ʊ����","��Ʊ���","��������"]`（U+FFFD 乱码），中文列名过滤失配 → 服务降级为 `source=local` 本地计算，退出码 1
- 修复后输出：列名 `["序号","股票代码","股票简称","连涨天数"]`，数据来源 `tonghuashun`，退出码 0

### 5.2 修复项

| 编号 | 问题 | 修复 | 位置 |
|---|---|---|---|
| P1 | 同花顺 GBK 页面被按 UTF-8 解码 → 列名乱码 + 榜单整体降级 | 新增字符集感知解码工具，按 BOM → HTTP 头 charset → 文档 meta charset → UTF-8 顺序选编码，并提供 GBK 兜底 | `backend/src/charset.ts`（新增）、`backend/src/services/third-party-data-service.ts:222` |
| P2 | 来源页固定 UTF-8 解码 | 复用同一解码工具，按响应头 charset 解码 | `backend/src/services/holding-diagnosis-sources.ts:299` |
| P3 | Python 侧 `errors="ignore"` 静默丢字 | 新增 `decode_html_bytes`：按声明字符集 → UTF-8 → GB18030 依次尝试，最终以 `errors="replace"` 替换而非丢字 | `akshare-provider/akshare_provider/service.py:585`（调用点 `:223`） |
| P4 | 文件写入未显式 encoding | 两处 `writeFileSync` 补 `"utf8"` | `scripts/service-runtime.ts:53`、`scripts/service-start.ts:57` |
| P5 | 外部 SQLite 未校验编码 | 新增 `assertSourceEncoding`，非 UTF-8 源库直接报错并给出转换指引 | `backend/src/maintenance/batman-watchlist-import.ts:51` |
| P6 | 缺换行/编码护栏 | 新增 `.gitattributes`（`* text=auto eol=lf`）+ 仓库级编码守卫测试（BOM / CRLF / 非法 UTF-8 / U+FFFD） | `.gitattributes`（新增）、`backend/test/encoding-guard.test.ts`（新增） |

附带改造：`readHoldingDiagnosisSource` 支持注入 fetcher（默认仍是 `fetch`），使解码行为可测且不改变既有调用契约。

### 5.3 测试

- 新增用例：字符集工具 7 条、同花顺 GBK 集成 1 条、来源页 GBK 2 条、外部库编码 1 条、仓库编码守卫 2 条、Python 解码 5 条
- 后端：`bun test` 115 pass / 2 fail（2 项失败为既有 ai-candidate 用例，已用 HEAD worktree 对照确认与本次改动无关）
- 前端：`bun test` 29 文件 113 用例全绿
- Python：`python -m unittest discover -s tests` 17/17 通过
- `bun run lint`（tsc --noEmit / vue-tsc）通过；`bun run build` 通过

### 5.4 遗留（非编码问题）

- 同花顺 ajax 端点当前被 WAF 以 401/403 拦截，技术榜单仍会走本地降级；解码修复会在接口放行后自动生效。

