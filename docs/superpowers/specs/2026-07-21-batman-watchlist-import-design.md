# Batman 自选列表数据导入设计

## 目标

将 Batman SQLite 数据库中 `uid=99` 的自选记录导入 IronMan 本地数据库，仅写入 IronMan 账户 `batman@stark.com`。

## 数据范围

- 源数据库：`/Users/jie/Studio/Code/github/Batman/app/db/batman.db`
- 源表：`user_customized_record` 与 `item_info_table`
- 源记录：15 只股票和 1 只 ETF，共 16 条。
- 迁移字段：代码、名称、资产类型、交易所、目标价、备注、排序。

## 迁移策略

实现一个仅供本地维护使用的 Bun 脚本，显式接收源数据库路径和目标用户邮箱。

1. 读取 Batman `uid=99` 的自选记录，并联结标的信息。
2. 根据 Batman 类型和代码映射 IronMan 的 `asset_type` 与 `exchange`：股票按 `sh/sz/bj` 代码规则识别；基金记录使用 `fund`。
3. 在 IronMan `instruments` 中按 `(code, exchange)` 查找；不存在时创建标的，保留源名称。
4. 按 `(user_id, instrument_id)` 检查目标账户自选。已存在则跳过，不修改 IronMan 现有目标价、备注或排序。
5. 缺失记录插入 `watchlist_entries`，保留目标价、备注、排序及迁移时间。
6. 写入审计日志，包含源库、目标邮箱、导入数、跳过数和补齐标的数。

## 安全与失败处理

- 脚本拒绝未知目标账户，绝不使用默认用户或全局账户。
- 仅操作 IronMan 本地数据文件，不改写 Batman 源数据库。
- 在事务中完成 IronMan 的标的、自选和审计写入；读取或映射失败时回滚全部写入。
- 同一源数据可重复执行，第二次应只产生跳过记录。

## 验收

- 首次执行后，`batman@stark.com` 的自选列表包含 Batman 的 16 个代码。
- `000981` 保留目标价 `5.3`，`601138` 保留 `63.46`，`603122` 保留 `24.56`。
- `563230` 映射为基金标的，能够在 IronMan 自选工作台正常展示。
- 第二次执行不新增重复自选，并输出可验证的导入汇总。
