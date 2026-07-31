import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import InstrumentSearch from "./InstrumentSearch.vue";

const mocks = vi.hoisted(() => ({
  searchInstruments: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: { searchInstruments: mocks.searchInstruments },
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } }),
}));

describe("InstrumentSearch", () => {
  beforeEach(() => {
    mocks.searchInstruments.mockReset();
    mocks.searchInstruments.mockResolvedValue({
      items: [
        instrument({ id: "index-1", name: "上证指数" }),
        instrument({ code: "000001", exchange: "sz", id: "stock-1", name: "平安银行" }),
      ],
    });
  });

  test("shows compact popup results and clears the active search", async () => {
    const wrapper = mount(InstrumentSearch);

    await wrapper.get("input[placeholder='代码或名称']").setValue("000001");
    await flushPromises();

    expect(mocks.searchInstruments).toHaveBeenCalledWith("test-token", "000001");
    expect(wrapper.get("[role='listbox']").classes()).toContain("instrument-search-popover");
    expect(wrapper.get("[data-instrument-search-result='index-1']").text()).toContain("上证指数SH 000001 · index");

    await wrapper.get("button[aria-label='清空标的检索']").trigger("click");

    expect((wrapper.get("input[placeholder='代码或名称']").element as HTMLInputElement).value).toBe("");
    expect(wrapper.find("[role='listbox']").exists()).toBe(false);
  });

  test("emits a selection and closes the popup", async () => {
    const wrapper = mount(InstrumentSearch);
    await wrapper.get("input[placeholder='代码或名称']").setValue("000001");
    await flushPromises();

    await wrapper.get("[data-instrument-search-result='stock-1']").trigger("click");

    expect(wrapper.emitted("select")?.[0]?.[0]).toMatchObject({ id: "stock-1", name: "平安银行" });
    expect(wrapper.find("[role='listbox']").exists()).toBe(false);
  });

  test("shows the selected instrument in the search field and allows clearing it", async () => {
    const wrapper = mount(InstrumentSearch, {
      props: { selectedInstrument: instrument({ code: "000001", exchange: "sz", id: "stock-1", name: "平安银行" }) }
    });

    expect(wrapper.get("[data-selected-instrument]").text()).toContain("平安银行");
    expect(wrapper.get("[data-selected-instrument]").text()).toContain("SZ 000001");

    await wrapper.get("button[aria-label='清除已选标的']").trigger("click");

    expect(wrapper.emitted("clearSelection")).toHaveLength(1);
  });
});

function instrument(overrides: Partial<{
  code: string;
  exchange: "sh" | "sz";
  id: string;
  name: string;
}> = {}) {
  return {
    assetType: "index" as const,
    code: "000001",
    createdAt: "2026-07-30T00:00:00.000Z",
    exchange: "sh" as const,
    id: "instrument-1",
    name: "测试标的",
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...overrides,
  };
}
