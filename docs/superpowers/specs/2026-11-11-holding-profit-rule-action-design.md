# 持仓损盈规则操作设计

## 背景

系统配置页已经提供「损盈规则」，可保存 4 种止损策略和 5 种止盈策略，但没有任何页面消费这些设置。持仓信息页的「持股记录」需要增加一个行内操作，用当前价格与持仓成本判断是否触发用户配置的止损 / 止盈规则，并展示计算过程。

## 目标

- 在「持股记录」操作列「分时数据」之后增加损盈规则操作，使用单个图标。
- 图标按状态切换：触发止损、触发止盈、正常、数据不足。
- 点击图标弹出对话框，展示止损与止盈的触发价、当前价、计算依据、触发结论和提醒。
- 覆盖系统配置中的全部 9 种策略，需要历史日 K 时读取本地行情；数据不足时明确标记不可用，不影响持仓列表其他内容。

## 非目标

- 不新增定时扫描、推送提醒或告警记录。判定仅在页面加载和用户查看时计算。
- 不在前端复制规则计算逻辑。
- 不调整系统配置页面的规则表单。

## 数据流

`/api/assets/holdings/batman-workspace` 加载时会为每个持仓读取日 K 和最新价。损盈评估复用同一批 `bars` 与最新价，不额外请求行情：

1. `AssetsService.getHoldingWorkspace` 读取当前用户的损盈设置一次。
2. 对每条 `active` 持仓，使用平均成本、数量、最新价、日 K、首次买入日期计算 `profitRule`。
3. `closed` 持仓返回 `profitRule: null`。
4. 评估逻辑放在独立的纯函数模块 `profit-rule-service.ts`，便于单元测试。

## 返回结构

```ts
interface ProfitRuleCheck {
  kind: "stop_loss" | "take_profit";
  strategy: string;
  strategyLabel: string;
  status: "triggered" | "safe" | "unavailable";
  thresholdPrice: number | null;
  thresholdAmount: number | null;
  currentProfit: number | null;
  distancePercent: number | null;
  detail: string;
  basis: string[];
}

interface ProfitRuleEvaluation {
  signal: "stop_loss" | "take_profit" | "safe" | "unavailable";
  summary: string;
  asOf: string | null;
  stopLoss: ProfitRuleCheck;
  takeProfit: ProfitRuleCheck;
}
```

`profitRule` 在持仓记录上可空，旧客户端和旧测试数据不受影响。

`distancePercent = (当前价 − 触发价) / 触发价 × 100`。止损场景为负表示已跌破触发价；止盈场景为正表示已达到目标。

## 策略判定

### 止损

| 策略 | 触发价 | 触发条件 | 数据要求 |
| --- | --- | --- | --- |
| `fixed_percentage` | 成本 × (1 − 比例%) | 现价 ≤ 触发价 | 无 |
| `fixed_amount` | 成本 − 金额 / 数量 | 浮亏 ≥ 金额 | 数量 > 0 |
| `technical` | MA(周期) × (1 − 缓冲%) | 现价 ≤ 触发价 | 日 K ≥ 均线周期 |
| `atr` | 成本 − 倍数 × ATR(周期) | 现价 ≤ 触发价 | 日 K ≥ ATR 周期 + 1 |

### 止盈

| 策略 | 触发价 / 离场价 | 触发条件 | 数据要求 |
| --- | --- | --- | --- |
| `risk_reward` | 成本 + 盈亏比 × 每股止损空间 | 现价 ≥ 触发价 | 止损价可用且低于成本 |
| `trailing` | 持仓期最高价 × (1 − 回撤%) | 现价 ≤ 离场价 | 持仓期日 K |
| `atr_trailing` | 持仓期最高价 − 倍数 × ATR | 现价 ≤ 离场价 | 持仓期日 K 且满足 ATR 周期 |
| `ma_trail` | MA(跟踪周期) | 现价 ≤ 离场价 | 日 K ≥ 跟踪周期 |
| `scaled` | 成本 + 阶段盈亏比 × 每股止损空间 | 现价 ≥ 首个阶段目标 | 止损价可用且低于成本 |

移动类和均线类属于「跌破离场价」而非「涨到目标价」，`detail` 使用「离场价」「回撤触发」等措辞。持仓期最高价取首次买入业务日期之后的日 K 最高价。

ATR 使用真实波幅均值：`TR = max(high − low, |high − 前收|, |low − 前收|)`，取最近 N 根均值。

### 不可用场景

- 无最新行情：两条规则均不可用，整体 `signal = "unavailable"`。
- 日 K 不足：依赖历史行情的策略标记不可用，原因写入 `detail`。
- 止损价不可用或高于成本：`risk_reward` 与 `scaled` 不可用。

## 前端

### 图标

| 状态 | 图标 | 颜色 | 提示 |
| --- | --- | --- | --- |
| 触发止损 | `ShieldAlert` | 红色 | 已触发止损 |
| 触发止盈 | `Target` | 青色 | 已触发止盈 |
| 正常 | `ShieldCheck` | 默认灰 | 损盈规则 |
| 数据不足 | `ShieldQuestion` | 默认灰 | 损盈规则（数据不足） |

图标位于「分时数据」之后、「设置提醒」之前。

### 对话框

统一样式对话框，标题为「损盈规则 · 标的名」：

- 顶部：现价、成本价、行情日期、整体结论。
- 两张卡片：「止损规则」「止盈规则」，分别展示策略名、状态徽标、触发价 / 离场价、距触发百分比、对应盈亏金额、`detail` 与 `basis` 明细。
- 阶梯止盈额外列出各阶段目标价与建议卖出比例。
- 底部说明规则来自「系统配置 › 损盈规则」，计算基于当前行情与持仓成本。

不使用浏览器原生 `alert` / `confirm` / `prompt`。

## 错误处理

- 行情获取失败时保持现有行为：持仓仍按成本数据展示，损盈规则标记为数据不足。
- 非法或缺失的损盈设置由现有 `normalizeStopProfit` 兜底。
- 前端在 `profitRule` 缺失时隐藏状态颜色并按数据不足处理，不阻断渲染。

## 测试

- 评估器单测：9 种策略的触发与未触发、ATR / 均线数据不足、无现价、盈亏比依赖止损价、阶梯多阶段、持仓期最高价。
- 接口测试：修改损盈设置后评估结果变化；用户隔离；无行情时返回不可用。
- 前端测试：图标位置与提示、状态图标切换、点击打开对话框、两张规则卡渲染、数据不足降级、旧数据无 `profitRule` 正常渲染。

## 兼容性

- 新增字段可空，`/api/assets/holdings/workspace` 与 `/api/assets/holdings/batman-workspace` 同时返回。
- 不修改数据库结构。
- 现有系统配置与测试夹具无需变更。
