import { createRouter, createWebHashHistory } from "vue-router";
import AppShell from "@/components/AppShell.vue";
import { useSession } from "@/stores/session";

const placeholder = () => import("@/views/BatmanPlaceholderView.vue");

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/login", component: () => import("@/views/LoginView.vue"), meta: { public: true, title: "登录" } },
    {
      path: "/",
      component: AppShell,
      redirect: "/holding/list",
      meta: { title: "IronMan" },
      children: [
        { path: "customized/list", component: () => import("@/views/WatchlistView.vue"), meta: { title: "自选列表" } },
        { path: "holding/list", component: () => import("@/views/HoldingsView.vue"), meta: { title: "持仓信息" } },
        { path: "holding/detail", component: () => import("@/views/HoldingDetailView.vue"), meta: { title: "持仓详情" } },
        { path: "analysis/trend", component: () => import("@/views/TrendAnalysisView.vue"), meta: { title: "趋势计算" } },
        { path: "analysis/agent", component: () => import("@/views/AiConsultationView.vue"), meta: { title: "AI咨询" } },
        { path: "data/third/technical-data", component: () => import("@/views/third/ThirdTechnicalDataView.vue"), meta: { title: "技术数据" } },
        { path: "data/third/info-links", component: () => import("@/views/third/ThirdInfoLinksView.vue"), meta: { title: "资讯链接" } },
        { path: "data/third/market-cloud", component: () => import("@/views/third/ThirdMarketCloudView.vue"), meta: { title: "大盘云图" } },
        { path: "notes/leek-notes", component: () => import("@/views/LeekNotesView.vue"), meta: { title: "韭菜笔记" } },
        { path: "system/configuration", component: () => import("@/views/SystemConfigurationView.vue"), meta: { title: "系统配置" } },
        { path: "sytem/configuration", redirect: "/system/configuration" }
      ]
    },
    { path: "/:pathMatch(.*)*", redirect: "/holding/list" }
  ]
});

router.beforeEach(async (to) => {
  const { currentUser, validate } = useSession();
  if (to.meta.public === true) {
    return currentUser.value === null ? true : "/settings/profile";
  }
  if (!(await validate())) {
    return "/login";
  }
  return true;
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "IronMan")} | IronMan`;
});

export default router;
