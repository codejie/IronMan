import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ThirdPartyTechnicalTable } from "@/api/client";
import ThirdTechnicalDataView from "./ThirdTechnicalDataView.vue";

const mocks = vi.hoisted(() => ({
  thirdPartyTechnical: vi.fn()
}));

vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    thirdPartyTechnical: mocks.thirdPartyTechnical
  }
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({ token: { value: "test-token" } })
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function table(column: string, value: string): ThirdPartyTechnicalTable {
  return {
    columns: [column],
    rows: [{ values: { [column]: value }, instrument: null }],
    source: "akshare",
    updatedAt: "2026-07-24T00:00:00.000Z"
  };
}

describe("ThirdTechnicalDataView", () => {
  beforeEach(() => {
    mocks.thirdPartyTechnical.mockReset();
  });

  test("keeps only the latest tab response when requests complete out of order", async () => {
    const initial = deferred<ThirdPartyTechnicalTable>();
    const uptrend = deferred<ThirdPartyTechnicalTable>();
    mocks.thirdPartyTechnical.mockReturnValueOnce(initial.promise).mockReturnValueOnce(uptrend.promise);

    const wrapper = mount(ThirdTechnicalDataView, {
      global: {
        stubs: { InstrumentKLineDialog: true }
      }
    });
    await nextTick();

    await wrapper.get("button:nth-of-type(2)").trigger("click");
    await nextTick();

    expect(mocks.thirdPartyTechnical).toHaveBeenNthCalledWith(1, "test-token", { kind: "new_high", category: 3 });
    expect(mocks.thirdPartyTechnical).toHaveBeenNthCalledWith(2, "test-token", { kind: "uptrend", days: 3 });

    uptrend.resolve(table("连涨天数", "5"));
    await flushPromises();
    initial.resolve(table("新高分类", "历史新高"));
    await flushPromises();

    expect(wrapper.text()).toContain("连涨天数");
    expect(wrapper.text()).not.toContain("新高分类");
  });
});
