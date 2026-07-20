import type { Component } from "vue";
import { Activity, BellRing, CandlestickChart, CircleUserRound, ClipboardList, Clock3, Database, FileChartColumn, Landmark, LayoutDashboard, ListChecks, MessageSquare, Search, ShieldCheck, Star, Users, WalletCards } from "lucide-vue-next";

export type Role = "admin" | "user";
export type Release = "P0" | "P1" | "P2" | "P3";

export interface MenuItem {
  icon: Component;
  label: string;
  release: Release;
  requiresAdmin?: boolean;
  to: string;
}

export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

const menu: MenuGroup[] = [
  {
    label: "概览",
    items: [{ icon: LayoutDashboard, label: "仪表盘", release: "P1", to: "/dashboard" }]
  },
  {
    label: "资产",
    items: [
      { icon: Star, label: "自选", release: "P1", to: "/assets/watchlist" },
      { icon: WalletCards, label: "持仓", release: "P1", to: "/assets/holdings" },
      { icon: Landmark, label: "资金与流水", release: "P1", to: "/assets/cash" }
    ]
  },
  {
    label: "行情",
    items: [
      { icon: Search, label: "标的检索", release: "P1", to: "/market/instruments" },
      { icon: LayoutDashboard, label: "市场概览", release: "P3", to: "/market/overview" },
      { icon: Activity, label: "技术信号", release: "P3", to: "/market/signals" }
    ]
  },
  {
    label: "分析",
    items: [
      { icon: CandlestickChart, label: "技术图表", release: "P1", to: "/analysis/charts" },
      { icon: ListChecks, label: "策略方案", release: "P2", to: "/analysis/strategies" },
      { icon: Activity, label: "分析任务", release: "P2", to: "/analysis/tasks" },
      { icon: FileChartColumn, label: "分析报告", release: "P2", to: "/analysis/reports" }
    ]
  },
  {
    label: "自动化",
    items: [
      { icon: Clock3, label: "定时任务", release: "P2", to: "/automation/schedules" },
      { icon: BellRing, label: "提醒告警", release: "P2", to: "/automation/alerts" },
      { icon: ClipboardList, label: "执行记录", release: "P2", to: "/automation/runs" }
    ]
  },
  {
    label: "设置",
    items: [
      { icon: Database, label: "数据源", release: "P1", to: "/settings/data-sources" },
      { icon: Database, label: "交易日", release: "P1", to: "/settings/trading-calendar" },
      { icon: Database, label: "数据管理", release: "P3", to: "/settings/data" },
      { icon: MessageSquare, label: "AI 配置", release: "P3", to: "/settings/ai" },
      { icon: CircleUserRound, label: "个人与安全", release: "P0", to: "/settings/profile" }
    ]
  },
  {
    label: "智能",
    items: [{ icon: MessageSquare, label: "AI 咨询", release: "P3", to: "/assistant/chat" }]
  },
  {
    label: "笔记",
    items: [{ icon: FileChartColumn, label: "投资笔记", release: "P3", to: "/notes" }]
  },
  {
    label: "管理",
    items: [
      { icon: Users, label: "用户与角色", release: "P0", requiresAdmin: true, to: "/admin/users" },
      { icon: ClipboardList, label: "审计日志", release: "P0", requiresAdmin: true, to: "/admin/audit-logs" },
      { icon: Activity, label: "系统状态", release: "P0", requiresAdmin: true, to: "/admin/system" }
    ]
  }
];

export function menuFor(role: Role, releases: Release[]): MenuGroup[] {
  return menu
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => releases.includes(item.release) && (role === "admin" || !item.requiresAdmin))
    }))
    .filter((group) => group.items.length > 0);
}

export const navigationIcons = { ShieldCheck };
