#!/usr/bin/env bun
/**
 * 复现脚本：同花顺榜单 GBK 响应被按 UTF-8 解码导致中文列名乱码。
 *
 * 用法：bun scripts/repro-encoding.ts
 * 预期（修复前）：columns 出现 U+FFFD 乱码，且 "连涨天数" 过滤因列名失配而失效。
 * 预期（修复后）：columns 为 ["序号","股票代码","股票简称","连涨天数"]，过滤正常。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IronManDatabase } from "../backend/src/db/database";
import { MarketService } from "../backend/src/services/market-service";
import { SettingsService } from "../backend/src/services/settings-service";
import { ThirdPartyDataService } from "../backend/src/services/third-party-data-service";
import { gbkBytes, thsCharsetMetaMarkup } from "../backend/test/helpers/gbk-fixture";

const directory = mkdtempSync(join(tmpdir(), "ironman-repro-encoding-"));
const database = new IronManDatabase(join(directory, "ironman.sqlite"));

try {
  const market = new MarketService(database, new SettingsService(database));
  const thsResponse = () =>
    new Response(gbkBytes(thsCharsetMetaMarkup), {
      status: 200,
      headers: { "content-type": "text/html; charset=gbk" }
    });

  const service = new ThirdPartyDataService(
    database,
    market,
    async () => thsResponse(),
    { technical: async () => Promise.reject(new Error("AKShare unavailable")) }
  );

  const table = await service.technical(crypto.randomUUID(), { kind: "uptrend", days: 3 });
  const columns = table.columns;
  const broken = columns.filter((column) => column.includes("\uFFFD")).length;
  const firstRow = table.rows[0]?.values ?? {};

  console.log("=== 同花顺榜单解码复现 ===");
  console.log("响应编码         : GBK (content-type: text/html; charset=gbk)");
  console.log("解析出的列名     :", JSON.stringify(columns));
  console.log("含 U+FFFD 的列数 :", broken);
  console.log("首行数据         :", JSON.stringify(firstRow));
  console.log("数据来源         :", table.source);
  console.log("uptrend(days=3) 行数 :", table.rows.length, "（期望 2 行：连涨天数 4/5 均 >= 3）");

  const failed = broken > 0 || !columns.includes("连涨天数") || table.rows.length !== 2 || table.source !== "tonghuashun";
  console.log(failed ? "\n结论：复现成功 —— 存在 GBK 误解码缺陷" : "\n结论：未复现 —— 解码正常");
  process.exit(failed ? 1 : 0);
} finally {
  database.close();
  rmSync(directory, { force: true, recursive: true });
}
