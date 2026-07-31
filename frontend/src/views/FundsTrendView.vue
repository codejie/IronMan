<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError, type FundHistoryPoint, type FundHistoryResult } from "@/api/client";
import FundsAssetTrendChart from "@/components/FundsAssetTrendChart.vue";
import FundsHistoryStatus from "@/components/FundsHistoryStatus.vue";
import FundsProfitTrendChart from "@/components/FundsProfitTrendChart.vue";
import { useSession } from "@/stores/session";

type PeriodMonths = 3 | 6 | 12;

const { token } = useSession();
const router = useRouter();
const period = ref<PeriodMonths>(3);
const result = ref<FundHistoryResult | null>(null);
const isLoading = ref(false);
const errorMessage = ref("");
const page = ref(1);
const pageSize = 10;
const periods: Array<{ value: PeriodMonths; label: string }> = [
  { value: 3, label: "3个月" },
  { value: 6, label: "6个月" },
  { value: 12, label: "1年" },
];

const orderedPoints = computed(() => [...(result.value?.points ?? [])].reverse());
const totalPages = computed(() => Math.max(1, Math.ceil(orderedPoints.value.length / pageSize)));
const visiblePoints = computed(() => orderedPoints.value.slice((page.value - 1) * pageSize, page.value * pageSize));

async function load(): Promise<void> {
  if (token.value === null || isLoading.value) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const endDate = latestCompleteDate();
    result.value = await api.fundHistory(token.value, shiftMonths(endDate, -period.value), endDate);
    page.value = 1;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "资金趋势数据加载失败";
  } finally {
    isLoading.value = false;
  }
}

async function selectPeriod(value: PeriodMonths): Promise<void> {
  if (period.value === value) return;
  period.value = value;
  await load();
}

function goBack(): void {
  void router.push("/holding/list");
}

function money(value: number | null): string {
  return value === null ? "-" : value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function percent(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(2)}%`;
}

function tone(value: number | null): "up" | "down" | "" {
  return value === null || value === 0 ? "" : value > 0 ? "up" : "down";
}

function dataStatus(point: FundHistoryPoint): string {
  if (point.dataStatus === "complete") return point.carriedPriceCount > 0 ? `完整 · 沿用 ${point.carriedPriceCount}` : "完整";
  return `部分 · 沿用 ${point.carriedPriceCount} / 缺失 ${point.missingPriceCount}`;
}

function latestCompleteDate(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  return minutes >= 15 * 60 + 30 ? date : shiftDays(date, -1);
}

function shiftMonths(value: string, offset: number): string {
  const source = new Date(`${value}T00:00:00.000Z`);
  const day = source.getUTCDate();
  source.setUTCDate(1);
  source.setUTCMonth(source.getUTCMonth() + offset);
  const lastDay = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate();
  source.setUTCDate(Math.min(day, lastDay));
  return source.toISOString().slice(0, 10);
}

function shiftDays(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

onMounted(load);
</script>

<template>
  <section class="batman-workspace funds-trend-workspace">
    <header class="funds-trend-header">
      <div class="funds-trend-title">
        <button aria-label="返回持仓信息" class="batman-icon-button" data-hint="返回持仓信息" type="button" @click="goBack"><ArrowLeft :size="18" /></button>
        <h1>资金趋势</h1>
      </div>
      <div class="funds-period-switch" aria-label="时间范围">
        <button v-for="item in periods" :key="item.value" :class="{ active: period === item.value }" :data-period="item.value" :disabled="isLoading" type="button" @click="selectPeriod(item.value)">{{ item.label }}</button>
      </div>
    </header>

    <p v-if="errorMessage" class="funds-trend-error" role="alert">{{ errorMessage }}<button :disabled="isLoading" type="button" @click="load"><RefreshCw :class="{ spinning: isLoading }" :size="14" />重试</button></p>
    <div v-if="isLoading && result === null" class="funds-trend-loading"><RefreshCw class="spinning" :size="20" />正在生成资金历史</div>

    <template v-else-if="result">
      <FundsHistoryStatus :points="result.points" :state="result.state" />

      <div v-if="result.points.length === 0" class="funds-trend-empty">
        <strong>暂无可计算的资金历史</strong>
        <button class="batman-button" type="button" @click="goBack"><ArrowLeft :size="15" />返回持仓信息</button>
      </div>

      <template v-else>
        <div class="funds-metrics-strip">
          <div><span>期末总资产</span><strong>{{ money(result.summary.totalAssets) }}</strong></div>
          <div><span>持仓市值</span><strong>{{ money(result.summary.marketValue) }}</strong></div>
          <div><span>可用资金</span><strong>{{ money(result.summary.cashAvailable) }}</strong></div>
          <div><span>累计盈亏</span><strong :class="tone(result.summary.cumulativeProfit)">{{ money(result.summary.cumulativeProfit) }}</strong><small>{{ percent(result.summary.cumulativeProfitRate) }}</small></div>
          <div><span>区间最大回撤</span><strong class="down">{{ percent(result.summary.maxDrawdown) }}</strong></div>
        </div>

        <section class="funds-trend-panel">
          <header><h2>盈亏变化</h2><span>每日盈亏 / 累计盈亏</span></header>
          <FundsProfitTrendChart :points="result.points" />
        </section>

        <section class="funds-trend-panel">
          <header><h2>资产变化</h2><span>{{ result.points[0]?.tradeDate }} 至 {{ result.points.at(-1)?.tradeDate }}</span></header>
          <FundsAssetTrendChart :events="result.events" :points="result.points" />
        </section>

        <section class="funds-trend-details">
          <header><h2>每日明细</h2><span>{{ result.points.length }} 个交易日</span></header>
          <div class="batman-table-frame">
            <table class="batman-table funds-history-table">
              <thead><tr><th>交易日</th><th>总资产</th><th>市值</th><th>现金</th><th>本金</th><th>当日盈亏</th><th>累计盈亏</th><th>数据状态</th></tr></thead>
              <tbody><tr v-for="point in visiblePoints" :key="point.tradeDate"><td>{{ point.tradeDate }}</td><td>{{ money(point.totalAssets) }}</td><td>{{ money(point.marketValue) }}</td><td>{{ money(point.cashAvailable) }}</td><td>{{ money(point.principal) }}</td><td :class="tone(point.dailyProfit)">{{ money(point.dailyProfit) }}</td><td :class="tone(point.cumulativeProfit)">{{ money(point.cumulativeProfit) }}</td><td><span :class="['fund-data-status', point.dataStatus]">{{ dataStatus(point) }}</span></td></tr></tbody>
            </table>
          </div>
          <footer v-if="totalPages > 1" class="funds-history-pagination"><span>{{ page }} / {{ totalPages }}</span><button aria-label="上一页" class="batman-icon-button" :disabled="page === 1" data-hint="上一页" type="button" @click="page -= 1"><ChevronLeft :size="17" /></button><button aria-label="下一页" class="batman-icon-button" :disabled="page === totalPages" data-hint="下一页" type="button" @click="page += 1"><ChevronRight :size="17" /></button></footer>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.funds-trend-workspace { display: grid; gap: 14px; }
.funds-trend-header { align-items: center; border-bottom: 1px solid #2a3d55; display: flex; justify-content: space-between; min-height: 42px; padding-bottom: 10px; }
.funds-trend-title { align-items: center; display: flex; gap: 8px; }
.funds-trend-title h1 { color: #eef8ff; font-size: 19px; margin: 0; }
.funds-period-switch { background: #0f1827; border: 1px solid #31465f; border-radius: 5px; display: inline-flex; padding: 2px; }
.funds-period-switch button { background: transparent; border: 0; border-radius: 3px; color: #91a5ba; font-size: 12px; min-height: 29px; min-width: 58px; padding: 0 9px; }
.funds-period-switch button.active { background: #2e7471; color: #effffc; }
.funds-period-switch button:disabled { cursor: wait; opacity: .7; }
.funds-trend-error { align-items: center; background: #351e26; border: 1px solid #7c4651; border-radius: 5px; color: #f3a0a7; display: flex; font-size: 12px; justify-content: space-between; margin: 0; padding: 8px 11px; }
.funds-trend-error button { align-items: center; background: transparent; border: 0; color: #ffd0d3; display: inline-flex; gap: 5px; }
.funds-trend-loading, .funds-trend-empty { align-items: center; color: #8fa4ba; display: flex; gap: 9px; justify-content: center; min-height: 360px; }
.funds-trend-empty { flex-direction: column; }
.funds-trend-empty strong { color: #c9d8e4; font-size: 14px; }
.funds-metrics-strip { border-bottom: 1px solid #2b3e56; border-top: 1px solid #2b3e56; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); }
.funds-metrics-strip > div { min-width: 0; padding: 11px 14px; }
.funds-metrics-strip > div + div { border-left: 1px solid #26394f; }
.funds-metrics-strip span, .funds-metrics-strip small { color: #7f95aa; display: block; font-size: 11px; }
.funds-metrics-strip strong { color: #e5f0f8; display: inline-block; font-size: 17px; margin-top: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.funds-metrics-strip small { display: inline-block; margin-left: 7px; }
.funds-trend-panel, .funds-trend-details { border-bottom: 1px solid #293c53; padding: 5px 0 15px; }
.funds-trend-panel > header, .funds-trend-details > header { align-items: baseline; display: flex; justify-content: space-between; margin-bottom: 2px; }
.funds-trend-panel h2, .funds-trend-details h2 { color: #dce8f2; font-size: 14px; margin: 0; }
.funds-trend-panel header span, .funds-trend-details header span { color: #748ba1; font-size: 11px; }
.funds-history-table { min-width: 980px; width: 100%; }
.funds-history-table th, .funds-history-table td { font-size: 12px; padding: 8px 10px; }
.fund-data-status { color: #77d5ca; font-size: 11px; }
.fund-data-status.partial { color: #dfba62; }
.funds-history-pagination { align-items: center; color: #8398ad; display: flex; font-size: 11px; gap: 4px; justify-content: flex-end; margin-top: 8px; }
.funds-history-pagination span { margin-right: 4px; }
.funds-history-pagination button:disabled { opacity: .35; }
@media (max-width: 900px) { .funds-metrics-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }.funds-metrics-strip > div + div { border-left: 0; }.funds-metrics-strip > div:nth-child(even) { border-left: 1px solid #26394f; }.funds-metrics-strip > div:nth-child(n + 3) { border-top: 1px solid #26394f; } }
@media (max-width: 620px) { .funds-trend-header { align-items: stretch; flex-direction: column; gap: 10px; }.funds-period-switch { align-self: stretch; }.funds-period-switch button { flex: 1; }.funds-metrics-strip strong { font-size: 15px; } }
</style>
