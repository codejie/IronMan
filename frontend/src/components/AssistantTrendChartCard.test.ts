import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import type { AssistantChart } from "@/api/client";
import AssistantTrendChartCard from "./AssistantTrendChartCard.vue";

const chart: AssistantChart = {
  id: "trend-chart-1",
  title: "趋势与拐点",
  instrument: { id: "instrument-1", code: "600000", exchange: "sh", name: "浦发银行", assetType: "stock" },
  source: "mock",
  bars: [
    { date: "2026-07-20", open: 10, close: 10.2, low: 9.9, high: 10.3, volume: 1200 },
    { date: "2026-07-21", open: 10.2, close: 10.4, low: 10.1, high: 10.5, volume: 1400 }
  ],
  indicators: [],
  trend: {
    indicators: [
      { indicatorId: "MACD", lines: { dif: [null, 0.1], dea: [null, 0.08], hist: [null, 0.04] }, signals: [], turningPoints: [] },
      { indicatorId: "MA", lines: { ma: [null, 10.3] }, signals: [], turningPoints: [] }
    ],
    turningPoints: [
      { indicatorId: "MACD", date: "2026-07-21", direction: "bullish", level: "info", title: "MACD金叉", reason: "DIF 上穿 DEA", price: 10.4 }
    ],
    assessment: {
      direction: "bullish",
      turningPoints: [],
      risk: { level: "low", evidence: [], suggestedAction: "继续观察", reminder: null }
    }
  }
};

describe("AssistantTrendChartCard", () => {
  test("renders trend overlays and hides matching turning points with a disabled indicator", async () => {
    const wrapper = mount(AssistantTrendChartCard, {
      props: { chart },
      global: {
        stubs: {
          KLineChart: {
            props: ["annotations", "overlays", "subchart"],
            template: "<div data-kline-chart :data-annotations='annotations.length' :data-overlays='overlays.length' :data-subchart='subchart' />"
          }
        }
      }
    });

    const kline = () => wrapper.get("[data-kline-chart]");
    expect(wrapper.text()).toContain("浦发银行 600000");
    expect(wrapper.text()).toContain("偏多");
    expect(kline().attributes("data-annotations")).toBe("1");
    expect(kline().attributes("data-overlays")).toBe("4");
    expect(kline().attributes("data-subchart")).toBe("macd");

    await wrapper.get("button[aria-pressed='true']").trigger("click");

    expect(kline().attributes("data-annotations")).toBe("0");
    expect(kline().attributes("data-overlays")).toBe("1");
    expect(kline().attributes("data-subchart")).toBe("volume");
  });
});
