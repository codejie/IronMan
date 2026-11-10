import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";
import HoldingPerformanceChart from "./HoldingPerformanceChart.vue";

const mocks = vi.hoisted(() => {
  const chart = {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getHeight: () => 600,
    getWidth: () => 800,
    convertToPixel: vi.fn(() => [320, 300] as [number, number])
  };
  const captured: { option: unknown } = { option: null };
  return { chart, captured, init: vi.fn(() => chart), use: vi.fn() };
});

vi.mock("echarts/core", () => ({ init: mocks.init, use: mocks.use }));
vi.mock("echarts/charts", () => ({ BarChart: {}, CandlestickChart: {}, LineChart: {}, ScatterChart: {} }));
vi.mock("echarts/components", () => ({ AxisPointerComponent: {}, GridComponent: {}, LegendComponent: {}, TooltipComponent: {} }));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: {} }));

const bars = [
  { date: "2026-08-31", open: 8.1, close: 8.2, low: 8, high: 8.3, volume: 1000 },
  { date: "2026-09-01", open: 8.2, close: 8.4, low: 8.1, high: 8.6, volume: 1200 },
  { date: "2026-09-02", open: 8.4, close: 8.3, low: 8.2, high: 8.5, volume: 900 }
];

const annotation = {
  date: "2026-09-01",
  price: null,
  direction: "bullish" as const,
  level: "info" as const,
  title: "买入 1,000",
  reason: "价格 8.5 · 费用 5 · 时间 2026-09-01",
  color: "#fa7575",
  seriesName: "操作"
};

describe("HoldingPerformanceChart operation annotations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.captured.option = null;
    mocks.chart.setOption.mockImplementation((option: unknown) => {
      mocks.captured.option = option;
    });
    globalThis.ResizeObserver = class ResizeObserverMock implements ResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  test("keeps markers clean and places operation titles on the chart rail", async () => {
    const wrapper = mount(HoldingPerformanceChart, {
      props: { bars, trace: [], annotations: [annotation] }
    });
    await nextTick();
    await nextTick();

    const option = mocks.captured.option as {
      series: Array<{ type: string; data: Array<Record<string, unknown>> }>;
    };
    const scatter = option.series.find((series) => series.type === "scatter");
    expect(scatter?.data).toHaveLength(1);
    // 三角标记不再自带文字标签
    expect(scatter?.data[0]?.label).toBeUndefined();
    expect(scatter?.data[0]?.operationKey).toEqual(expect.any(String));

    const label = wrapper.get(".holding-operation-label");
    expect(label.text()).toBe("买入 1,000");
    expect(label.element.parentElement?.getAttribute("style") ?? "").toContain("left: 320px");
    expect(wrapper.find(".holding-operation-tip").exists()).toBe(false);

    await label.trigger("mouseenter");

    const tip = wrapper.get(".holding-operation-tip");
    expect(tip.text()).toContain("操作记录 · 2026/09/01");
    expect(tip.text()).toContain("买入 1,000");
    expect(tip.text()).toContain("价格 8.5 · 费用 5 · 时间 2026-09-01");
    expect(wrapper.find(".holding-operation-connector-layer line").exists()).toBe(true);

    await label.trigger("mouseleave");
    expect(wrapper.find(".holding-operation-tip").exists()).toBe(false);
  });

  test("ignores annotations outside the visible bar window", async () => {
    const wrapper = mount(HoldingPerformanceChart, {
      props: {
        bars,
        trace: [],
        annotations: [{ ...annotation, date: "2026-07-01" }]
      }
    });
    await nextTick();

    expect(wrapper.find(".holding-operation-label").exists()).toBe(false);
    const option = mocks.captured.option as { series: Array<{ type: string }> };
    expect(option.series.some((series) => series.type === "scatter")).toBe(false);
  });
});
