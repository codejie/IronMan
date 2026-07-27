import { afterEach, describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import AppConfirmDialog from "./AppConfirmDialog.vue";
import { confirmationState, requestConfirmation, requestConfirmationAction, settleConfirmation } from "./confirmation";

afterEach(() => {
  settleConfirmation(false);
  document.body.innerHTML = "";
});

describe("AppConfirmDialog", () => {
  test("uses the shared dialog to resolve confirmation and cancellation", async () => {
    const wrapper = mount(AppConfirmDialog, { attachTo: document.body });

    const accepted = requestConfirmation({ title: "删除记录", message: "确认删除吗？", confirmLabel: "删除", tone: "danger" });
    await nextTick();
    expect(wrapper.text()).toContain("删除记录");
    expect(wrapper.text()).toContain("确认删除吗？");
    await wrapper.get("button.danger").trigger("click");
    await expect(accepted).resolves.toBe(true);

    const cancelled = requestConfirmation({ title: "停止计算", message: "确认停止吗？" });
    await nextTick();
    await wrapper.get("button:not(.primary):not(.danger)").trigger("click");
    await expect(cancelled).resolves.toBe(false);
    expect(confirmationState.isOpen).toBe(false);

    wrapper.unmount();
  });

  test("supports an explicit discard action for unsaved work", async () => {
    const wrapper = mount(AppConfirmDialog, { attachTo: document.body });

    const action = requestConfirmationAction({
      title: "未保存的修改",
      message: "是否保存当前笔记？",
      confirmLabel: "保存后继续",
      discardLabel: "放弃修改"
    });
    await nextTick();
    await wrapper.get("[data-confirm-discard]").trigger("click");

    await expect(action).resolves.toBe("discard");
    expect(confirmationState.isOpen).toBe(false);
    wrapper.unmount();
  });
});
