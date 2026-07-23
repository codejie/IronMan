# 日期与时间展示规范

工程前端展示日期和时间时使用统一格式化工具：`frontend/src/utils/date-format.ts`。

| 数据类型 | 展示格式 | 示例 |
| --- | --- | --- |
| date | `yyyy/mm/dd` | `2026/07/22` |
| date and time | `yyyy/mm/dd HH:MM:SS` | `2026/07/22 09:08:07` |
| 无秒的 date and time | `yyyy/mm/dd HH:MM` | `2026/07/22 09:08` |

规则：

- 页面不得直接使用 `toLocaleDateString()`、`toLocaleString()` 或 `toLocaleTimeString()` 输出业务时间。
- 原始时间字符串没有秒时，不显示 `:SS`；原始值明确包含秒时，保留秒。
- 日期和时间按浏览器本地时区显示；仅日期值按其自身日期显示，不做 UTC 偏移。
- 表单控件、接口参数和内部计算可继续使用 ISO 格式，不属于展示文本。
