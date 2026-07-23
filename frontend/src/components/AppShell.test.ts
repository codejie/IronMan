import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AppShell from "./AppShell.vue";

vi.mock("@/stores/session", () => ({
  useSession: () => ({ logout: vi.fn() })
}));

describe("AppShell", () => {
  test("collapses and expands the navigation from the brand control", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ component: { template: "<div />" }, path: "/holding/list" }]
    });
    await router.push("/holding/list");
    await router.isReady();

    const wrapper = mount(AppShell, { global: { plugins: [router] } });
    const collapseButton = wrapper.get('button[aria-label="收起菜单"]');

    await collapseButton.trigger("click");
    expect(wrapper.classes()).toContain("is-sidebar-collapsed");
    expect(wrapper.get('button[aria-label="展开菜单"]').attributes("aria-label")).toBe("展开菜单");

    await wrapper.get('button[aria-label="展开菜单"]').trigger("click");
    expect(wrapper.classes()).not.toContain("is-sidebar-collapsed");
  });
});
