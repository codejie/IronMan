import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import AppShell from "./AppShell.vue";

const mocks = vi.hoisted(() => ({
  logout: vi.fn()
}));

vi.mock("@/stores/session", () => ({
  useSession: () => ({
    currentUser: {
      value: {
        displayName: "测试用户",
        email: "test@example.com"
      }
    },
    logout: mocks.logout
  })
}));

describe("AppShell", () => {
  function router() {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { component: { template: "<div />" }, path: "/analysis/agent" },
        { component: { template: "<div />" }, path: "/analysis/trend" },
        { component: { template: "<div />" }, path: "/automation/alerts" },
        { component: { template: "<div />" }, path: "/customized/list" },
        { component: { template: "<div />" }, path: "/data/third/info-links" },
        { component: { template: "<div />" }, path: "/data/third/market-cloud" },
        { component: { template: "<div />" }, path: "/data/third/technical-data" },
        { component: { template: "<div />" }, path: "/holding/list" },
        { component: { template: "<div />" }, path: "/login" },
        { component: { template: "<div />" }, path: "/notes/leek-notes" },
        { component: { template: "<div />" }, path: "/settings/profile" },
        { component: { template: "<div />" }, path: "/system/configuration" }
      ]
    });
  }

  test("collapses and expands the navigation from the brand control", async () => {
    const testRouter = router();
    await testRouter.push("/holding/list");
    await testRouter.isReady();

    const wrapper = mount(AppShell, { global: { plugins: [testRouter] } });
    const collapseButton = wrapper.get('button[aria-label="收起菜单"]');

    await collapseButton.trigger("click");
    expect(wrapper.classes()).toContain("is-sidebar-collapsed");
    expect(wrapper.get('button[aria-label="展开菜单"]').attributes("aria-label")).toBe("展开菜单");

    await wrapper.get('button[aria-label="展开菜单"]').trigger("click");
    expect(wrapper.classes()).not.toContain("is-sidebar-collapsed");
  });

  test("keeps alert and user entries in the sidebar footer and nests sign out under user", async () => {
    mocks.logout.mockResolvedValue(undefined);
    const testRouter = router();
    await testRouter.push("/holding/list");
    await testRouter.isReady();

    const wrapper = mount(AppShell, { global: { plugins: [testRouter] } });

    expect(wrapper.get('a[aria-label="提醒"]').attributes("href")).toContain(
      "/automation/alerts"
    );
    expect(wrapper.get(".batman-user-menu").attributes("style")).toContain(
      "display: none"
    );

    await wrapper.get('button[aria-label="用户"]').trigger("click");
    expect(wrapper.get(".batman-user-menu").text()).toContain("测试用户");
    expect(wrapper.get('a[aria-label="用户设置"]').attributes("href")).toContain(
      "/settings/profile"
    );
    expect(wrapper.get(".batman-user-menu").attributes("style") ?? "").not.toContain(
      "display: none"
    );

    await wrapper.get('button[aria-label="退出登录"]').trigger("click");
    await flushPromises();
    expect(mocks.logout).toHaveBeenCalled();
    expect(testRouter.currentRoute.value.path).toBe("/login");
  });
});
