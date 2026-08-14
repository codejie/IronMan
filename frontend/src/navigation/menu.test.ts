import { describe, expect, test } from "vitest";
import { isMenuSection, menuFor, menuItems } from "./menu";

describe("Batman navigation", () => {
  test("uses Batman's top-level menu labels and ordering", () => {
    expect(menuFor().map((item) => item.label)).toEqual(["自选列表", "持仓信息", "数据分析", "三方数据", "韭菜笔记", "系统配置"]);
  });

  test("preserves Batman analysis and third-party submenus", () => {
    const sections = menuFor().filter(isMenuSection);

    expect(sections.find((item) => item.label === "数据分析")?.children.map((item) => item.label)).toEqual(["趋势计算", "持仓诊断", "AI候选", "AI咨询"]);
    expect(sections.find((item) => item.label === "三方数据")?.children.map((item) => item.label)).toEqual(["技术数据", "资讯链接", "大盘云图"]);
  });

  test("maps active asset routes and deferred Batman pages", () => {
    expect(menuItems(menuFor()).map((item) => item.to)).toEqual([
      "/customized/list",
      "/holding/list",
      "/analysis/trend",
      "/analysis/holding-diagnosis",
      "/analysis/ai-candidates",
      "/analysis/agent",
      "/data/third/technical-data",
      "/data/third/info-links",
      "/data/third/market-cloud",
      "/notes/leek-notes",
      "/system/configuration"
    ]);
  });
});
