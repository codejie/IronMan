import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import InstrumentPickerDialog from "./InstrumentPickerDialog.vue";

const mocks = vi.hoisted(() => ({
  searchInstruments: vi.fn()
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ApiError";
    }
  },
  api: {
    searchInstruments: mocks.searchInstruments
  }
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } })
}));

describe("InstrumentPickerDialog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.searchInstruments.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("filters search results by selected type and emits the selected instrument", async () => {
    const stock = instrument({ assetType: "stock", code: "600519", id: "stock-1", name: "贵州茅台" });
    mocks.searchInstruments.mockResolvedValue({
      items: [stock, instrument({ assetType: "index", code: "000300", id: "index-1", name: "沪深300" })]
    });

    const wrapper = mount(InstrumentPickerDialog, { props: { open: true, title: "新增自选" } });

    await wrapper.get("input[placeholder='输入代码或名称']").setValue("茅台");
    await vi.advanceTimersByTimeAsync(240);
    await flushPromises();

    expect(mocks.searchInstruments).toHaveBeenCalledWith("test-token", "茅台", "stock");
    expect(wrapper.text()).toContain("贵州茅台");
    expect(wrapper.text()).not.toContain("沪深300");

    await wrapper.get("[data-instrument-picker-result='stock-1']").trigger("click");
    await wrapper.get("button[data-instrument-picker-confirm]").trigger("click");

    expect(wrapper.emitted("confirm")).toEqual([[stock]]);
  });

  test("shows a request error without emitting a selection", async () => {
    mocks.searchInstruments.mockRejectedValue(new Error("行情服务不可用"));
    const wrapper = mount(InstrumentPickerDialog, { props: { open: true, title: "新增自选" } });

    await wrapper.get("input[placeholder='输入代码或名称']").setValue("600519");
    await vi.advanceTimersByTimeAsync(240);
    await flushPromises();

    expect(wrapper.text()).toContain("无法检索标的");
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });

  test("searches again with the selected type after the type changes", async () => {
    mocks.searchInstruments.mockResolvedValue({ items: [] });
    const wrapper = mount(InstrumentPickerDialog, { props: { open: true, title: "新增持股" } });

    await wrapper.get("input[placeholder='输入代码或名称']").setValue("000001");
    await vi.advanceTimersByTimeAsync(240);
    await flushPromises();

    await wrapper.get("select").setValue("index");
    await vi.advanceTimersByTimeAsync(240);
    await flushPromises();

    expect(mocks.searchInstruments).toHaveBeenLastCalledWith("test-token", "000001", "index");
  });
});

function instrument(overrides: Partial<{
  assetType: "stock" | "index" | "fund";
  code: string;
  id: string;
  name: string;
}> = {}) {
  return {
    assetType: "stock" as const,
    code: "000001",
    createdAt: "2026-07-24T00:00:00.000Z",
    exchange: "sz" as const,
    id: "instrument-1",
    name: "测试标的",
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides
  };
}
