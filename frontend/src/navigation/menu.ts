import type { Component } from "vue";
import { BarChart3, BrainCircuit, CandlestickChart, ChartNoAxesCombined, Landmark, Link2, NotebookPen, PanelsTopLeft, ScanSearch, Settings2, Star, TrendingUp } from "lucide-vue-next";

export interface MenuItem {
  icon: Component;
  label: string;
  to: string;
}

export interface MenuSection {
  children: MenuItem[];
  icon: Component;
  label: string;
}

export type MenuNode = MenuItem | MenuSection;

const menu: MenuNode[] = [
  { icon: Star, label: "自选列表", to: "/customized/list" },
  { icon: Landmark, label: "持仓信息", to: "/holding/list" },
  {
    children: [
      { icon: TrendingUp, label: "趋势计算", to: "/analysis/trend" },
      { icon: ScanSearch, label: "持仓诊断", to: "/analysis/holding-diagnosis" },
      { icon: BrainCircuit, label: "AI咨询", to: "/analysis/agent" }
    ],
    icon: CandlestickChart,
    label: "数据分析"
  },
  {
    children: [
      { icon: BarChart3, label: "技术数据", to: "/data/third/technical-data" },
      { icon: Link2, label: "资讯链接", to: "/data/third/info-links" },
      { icon: PanelsTopLeft, label: "大盘云图", to: "/data/third/market-cloud" }
    ],
    icon: ChartNoAxesCombined,
    label: "三方数据"
  },
  { icon: NotebookPen, label: "韭菜笔记", to: "/notes/leek-notes" },
  { icon: Settings2, label: "系统配置", to: "/system/configuration" }
];

export function isMenuSection(node: MenuNode): node is MenuSection {
  return "children" in node;
}

export function menuFor(): MenuNode[] {
  return menu;
}

export function menuItems(nodes: MenuNode[]): MenuItem[] {
  return nodes.flatMap((node) => (isMenuSection(node) ? node.children : [node]));
}
