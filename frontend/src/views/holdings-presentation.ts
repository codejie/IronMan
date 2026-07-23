import { formatDate } from "@/utils/date-format";

interface HoldingProfitSummarySource {
  principal: number;
  profit: number;
}

interface ClosedHoldingProfitSource {
  profit: number | null;
}

export interface HoldingProfitSummary {
  activeProfit: number;
  activeProfitRate: number | null;
  closedProfit: number;
  totalProfit: number;
  totalProfitRate: number | null;
}

export function holdingProfitSummary(summary: HoldingProfitSummarySource, closedRecords: ClosedHoldingProfitSource[]): HoldingProfitSummary {
  const closedProfit = Number(closedRecords.reduce((total, record) => total + (record.profit ?? 0), 0).toFixed(6));
  const totalProfit = summary.profit;
  const activeProfit = Number((totalProfit - closedProfit).toFixed(6));
  const denominator = Math.abs(summary.principal);
  return {
    activeProfit,
    activeProfitRate: denominator === 0 ? null : Number((activeProfit / denominator * 100).toFixed(4)),
    closedProfit,
    totalProfit,
    totalProfitRate: denominator === 0 ? null : Number((totalProfit / denominator * 100).toFixed(4))
  };
}

export function holdingQuoteDateLabel(value: string | null): string {
  const date = formatDate(value);
  return date === "-" ? "[-]" : `[${date.slice(5)}]`;
}
