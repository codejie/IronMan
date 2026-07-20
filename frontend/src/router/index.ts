import { createRouter, createWebHistory } from "vue-router";
import AppShell from "@/components/AppShell.vue";
import { useSession } from "@/stores/session";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: () => import("@/views/LoginView.vue"), meta: { public: true, title: "登录" } },
    {
      path: "/",
      component: AppShell,
      redirect: "/dashboard",
      meta: { title: "IronMan" },
      children: [
        { path: "dashboard", component: () => import("@/views/DashboardView.vue"), meta: { title: "仪表盘" } },
        { path: "assets/watchlist", component: () => import("@/views/WatchlistView.vue"), meta: { title: "自选" } },
        { path: "assets/holdings", component: () => import("@/views/HoldingsView.vue"), meta: { title: "持仓" } },
        { path: "assets/cash", component: () => import("@/views/CashView.vue"), meta: { title: "资金与流水" } },
        { path: "market/instruments", component: () => import("@/views/InstrumentsView.vue"), meta: { title: "标的检索" } },
        { path: "market/overview", component: () => import("@/views/MarketOverviewView.vue"), meta: { title: "市场概览" } },
        { path: "market/signals", component: () => import("@/views/MarketSignalsView.vue"), meta: { title: "技术信号" } },
        { path: "analysis/charts", component: () => import("@/views/ChartView.vue"), meta: { title: "技术图表" } },
        { path: "analysis/strategies", component: () => import("@/views/StrategiesView.vue"), meta: { title: "策略方案" } },
        { path: "analysis/tasks", component: () => import("@/views/TasksView.vue"), meta: { title: "分析任务" } },
        { path: "analysis/reports", component: () => import("@/views/ReportsView.vue"), meta: { title: "分析报告" } },
        { path: "automation/schedules", component: () => import("@/views/SchedulesView.vue"), meta: { title: "定时任务" } },
        { path: "automation/alerts", component: () => import("@/views/AlertsView.vue"), meta: { title: "提醒告警" } },
        { path: "automation/runs", component: () => import("@/views/RunsView.vue"), meta: { title: "执行记录" } },
        { path: "settings/data-sources", component: () => import("@/views/DataSourcesView.vue"), meta: { title: "数据源" } },
        { path: "settings/trading-calendar", component: () => import("@/views/TradingCalendarView.vue"), meta: { title: "交易日" } },
        { path: "settings/data", component: () => import("@/views/DataManagementView.vue"), meta: { title: "数据管理" } },
        { path: "settings/ai", component: () => import("@/views/AiSettingsView.vue"), meta: { title: "AI 配置" } },
        { path: "assistant/chat", component: () => import("@/views/AiChatView.vue"), meta: { title: "AI 咨询" } },
        { path: "notes", component: () => import("@/views/NotesView.vue"), meta: { title: "投资笔记" } },
        { path: "settings/profile", component: () => import("@/views/ProfileView.vue"), meta: { title: "个人与安全" } },
        { path: "admin/users", component: () => import("@/views/AdminUsersView.vue"), meta: { admin: true, title: "用户与角色" } },
        { path: "admin/audit-logs", component: () => import("@/views/AdminAuditLogsView.vue"), meta: { admin: true, title: "审计日志" } },
        { path: "admin/system", component: () => import("@/views/AdminSystemView.vue"), meta: { admin: true, title: "系统状态" } }
      ]
    },
    { path: "/:pathMatch(.*)*", redirect: "/settings/profile" }
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
  if (to.meta.admin === true && currentUser.value?.role !== "admin") {
    return "/settings/profile";
  }
  return true;
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title ?? "IronMan")} | IronMan`;
});

export default router;
