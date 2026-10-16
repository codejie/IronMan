import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { formatDate } from "@/utils/date-format";
import HoldingDetailView from "./HoldingDetailView.vue";

const mocks = vi.hoisted(() => ({
  addHoldingTransaction: vi.fn(),
  deleteHoldingTransaction: vi.fn(),
  holdingChart: vi.fn(),
  push: vi.fn(),
  requestConfirmation: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    addHoldingTransaction: mocks.addHoldingTransaction,
    deleteHoldingTransaction: mocks.deleteHoldingTransaction,
    holdingChart: mocks.holdingChart,
  },
}));

vi.mock("@/components/confirmation", () => ({
  requestConfirmation: mocks.requestConfirmation,
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { id: "holding-1", ids: "holding-1" } }),
  useRouter: () => ({ push: mocks.push }),
}));

describe("HoldingDetailView", () => {
  beforeEach(() => {
    mocks.addHoldingTransaction.mockReset();
    mocks.deleteHoldingTransaction.mockReset();
    mocks.holdingChart.mockReset();
    mocks.push.mockReset();
    mocks.requestConfirmation.mockReset();
    mocks.addHoldingTransaction.mockResolvedValue({ id: "operation-2" });
    mocks.deleteHoldingTransaction.mockResolvedValue({ deleted: true });
    mocks.holdingChart.mockResolvedValue(detail());
    mocks.requestConfirmation.mockResolvedValue(true);
  });

  test("creates an operation from the operations table toolbar", async () => {
    const wrapper = mount(HoldingDetailView, {
      global: { stubs: { HoldingPerformanceChart: true } },
    });
    await flushPromises();

    expect(wrapper.find(".holding-detail-heading button[aria-label='为 测试标的 增加操作']").exists()).toBe(false);
    const toolbar = wrapper.get(".holding-detail-operations-toolbar");
    const create = toolbar.get("button[aria-label='为 测试标的 增加操作']");
    expect(create.text()).toContain("增加操作");
    await create.trigger("click");

    const dialog = wrapper.get("form[aria-label='新增操作']");
    await dialog.get("select").setValue("sell");
    await dialog.get("input[aria-label='数量']").setValue("20");
    await dialog.get("input[aria-label='价格']").setValue("12.5");
    await dialog.trigger("submit");
    await flushPromises();

    expect(mocks.addHoldingTransaction).toHaveBeenCalledWith("test-token", expect.objectContaining({
      holdingId: "holding-1",
      action: "sell",
      quantity: 20,
      price: 12.5,
    }));
    expect(mocks.holdingChart).toHaveBeenCalledTimes(2);
  });

  test("renders operation timestamps as dates only", async () => {
    const wrapper = mount(HoldingDetailView, {
      global: { stubs: { HoldingPerformanceChart: true } },
    });
    await flushPromises();

    const cells = wrapper.findAll(".holding-detail-table tbody tr td:first-child");
    expect(cells).toHaveLength(2);
    expect(cells[0]!.text()).toBe(formatDate("2026-07-01T00:00:00.000Z"));
    expect(cells[1]!.text()).toBe(formatDate("2026-07-05T00:00:00.000Z"));
    for (const cell of cells) expect(cell.text()).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  test("records a dividend through the interest action with holding quantity and per-share price", async () => {
    const wrapper = mount(HoldingDetailView, {
      global: { stubs: { HoldingPerformanceChart: true } },
    });
    await flushPromises();

    await wrapper.get(".holding-detail-operations-toolbar button").trigger("click");
    const dialog = wrapper.get("form[aria-label='新增操作']");
    await dialog.get("select").setValue("interest");

    expect((dialog.get("input[aria-label='持仓数量']").element as HTMLInputElement).value).toBe("100");
    await dialog.get("input[aria-label='分红单价']").setValue("0.5");
    expect(dialog.text()).toContain("分红金额 = 持仓数量 × 分红单价：50.00");

    await dialog.trigger("submit");
    await flushPromises();

    expect(mocks.addHoldingTransaction).toHaveBeenCalledWith("test-token", expect.objectContaining({
      holdingId: "holding-1",
      action: "interest",
      quantity: 100,
      price: 0.5,
      fee: 0,
    }));
  });

  test("deletes an operation through confirmation and reloads the holding summary", async () => {
    const wrapper = mount(HoldingDetailView, {
      global: { stubs: { HoldingPerformanceChart: true } },
    });
    await flushPromises();

    const remove = wrapper.get("button[aria-label='删除买入操作']");
    expect(remove.attributes("data-hint")).toBe("删除操作");
    expect(remove.attributes("data-hint-position")).toBe("top");
    await remove.trigger("click");
    await flushPromises();

    expect(mocks.requestConfirmation).toHaveBeenCalledWith(expect.objectContaining({
      title: "删除操作记录",
      confirmLabel: "删除",
      tone: "danger",
    }));
    expect(mocks.deleteHoldingTransaction).toHaveBeenCalledWith("test-token", "holding-1", "operation-1");
    expect(mocks.holdingChart).toHaveBeenCalledTimes(2);
  });

  test("does not offer a new operation for a closed holding", async () => {
    mocks.holdingChart.mockResolvedValue(detail("closed"));
    const wrapper = mount(HoldingDetailView, {
      global: { stubs: { HoldingPerformanceChart: true } },
    });
    await flushPromises();

    expect(wrapper.find("button[aria-label='为 测试标的 增加操作']").exists()).toBe(false);
  });
});

function detail(status: "active" | "closed" = "active") {
  return {
    holding: {
      id: "holding-1",
      status,
      quantity: 100,
      cost: 1000,
      averageCost: 10,
      instrument: { id: "instrument-1", code: "600000", exchange: "sh", name: "测试标的", assetType: "stock" },
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    transactions: [
      { id: "operation-1", action: "buy", quantity: 100, price: 10, fee: 0, cashImpact: -1000, occurredAt: "2026-07-01T00:00:00.000Z", note: "" },
      { id: "operation-3", action: "interest", quantity: 100, price: 0.5, fee: 0, cashImpact: 50, occurredAt: "2026-07-05T00:00:00.000Z", note: "分红" },
    ],
    bars: [{ date: "2026-07-01", open: 10, close: 11, high: 11, low: 10, volume: 1000 }],
    trace: [{ date: "2026-07-01", quantity: 100, netCost: 1000, averageCost: 10, marketValue: 1100, profit: 100 }],
    macdLines: {},
  };
}
