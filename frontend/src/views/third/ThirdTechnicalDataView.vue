<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { BarChart3, CalendarDays, RefreshCw, TrendingUp, Waves } from "lucide-vue-next";
import InstrumentKLineDialog from "@/components/InstrumentKLineDialog.vue";
import { api, ApiError, type Instrument, type ThirdPartyTechnicalKind, type ThirdPartyTechnicalTable, type ThirdPartyTableValue } from "@/api/client";
import { useSession } from "@/stores/session";
import { formatDateTime } from "@/utils/date-format";

type TechnicalTab = {
  kind: ThirdPartyTechnicalKind;
  label: string;
  icon: typeof TrendingUp;
};

const tabs: TechnicalTab[] = [
  { kind: "new_high", label: "创新高", icon: TrendingUp },
  { kind: "uptrend", label: "连续上涨", icon: TrendingUp },
  { kind: "high_volume", label: "持续放量", icon: BarChart3 },
  { kind: "rise_volume_price", label: "量价齐升", icon: Waves },
  { kind: "limit_up_pool", label: "涨停股池", icon: CalendarDays }
];
const newHighOptions = [
  { value: 3, label: "历史新高" },
  { value: 1, label: "半年新高" },
  { value: 2, label: "一年新高" },
  { value: 0, label: "月创新高" }
];
const daysOptions = [9, 8, 7, 6, 5, 4, 3, 2, 1];

const { token } = useSession();
const activeKind = ref<ThirdPartyTechnicalKind>("new_high");
const category = ref(3);
const days = ref(3);
const date = ref("");
const table = ref<ThirdPartyTechnicalTable | null>(null);
const isLoading = ref(false);
const errorMessage = ref("");
const selectedInstrument = ref<Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType"> | null>(null);
let requestSequence = 0;

const activeTab = computed(() => tabs.find((tab) => tab.kind === activeKind.value) ?? tabs[0]!);
const columns = computed(() => table.value?.columns ?? []);
const rows = computed(() => table.value?.rows ?? []);
const sourceLabel = computed(() => {
  if (table.value?.source === "akshare") return "AKShare 榜单";
  if (table.value?.source === "tonghuashun") return "同花顺榜单";
  if (table.value?.source === "eastmoney") return "东方财富";
  if (table.value?.source === "local") return "本地行情计算";
  return "";
});
const hasDayFilter = computed(() => ["uptrend", "high_volume", "rise_volume_price"].includes(activeKind.value));

function currentQuery(): { kind: ThirdPartyTechnicalKind; category?: number; days?: number; date?: string } {
  if (activeKind.value === "new_high") return { kind: activeKind.value, category: category.value };
  if (hasDayFilter.value) return { kind: activeKind.value, days: days.value };
  if (activeKind.value === "limit_up_pool") return { kind: activeKind.value, date: date.value || undefined };
  return { kind: activeKind.value };
}

async function load(): Promise<void> {
  if (token.value === null) return;
  const requestId = ++requestSequence;
  const query = currentQuery();
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const nextTable = await api.thirdPartyTechnical(token.value, query);
    if (requestId !== requestSequence) return;
    table.value = nextTable;
  } catch (error) {
    if (requestId !== requestSequence) return;
    errorMessage.value = error instanceof ApiError ? error.message : "读取技术数据失败";
    table.value = null;
  } finally {
    if (requestId === requestSequence) isLoading.value = false;
  }
}

function selectTab(kind: ThirdPartyTechnicalKind): void {
  if (activeKind.value === kind) return;
  activeKind.value = kind;
  void load();
}

function formatValue(value: ThirdPartyTableValue, column: string): string {
  if (value === null || value === "") return "--";
  if (typeof value !== "number") return value;
  if (column.includes("成交额") || column.includes("市值") || column.includes("封板资金")) {
    if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
    if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(2)}万`;
  }
  if (column.includes("涨跌幅") || column.includes("换手率") || column.includes("放量倍数")) return `${value.toFixed(2)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(Math.abs(value) < 10 ? 4 : 2);
}

function openKline(instrument: ThirdPartyTechnicalTable["rows"][number]["instrument"]): void {
  if (instrument !== null) selectedInstrument.value = instrument;
}

watch(category, () => activeKind.value === "new_high" && void load());
watch(days, () => hasDayFilter.value && void load());
watch(date, () => activeKind.value === "limit_up_pool" && void load());
onMounted(() => void load());
</script>

<template>
  <section class="batman-workspace third-party-technical" aria-label="技术数据">
    <header class="third-party-heading">
      <h1>技术数据</h1>
      <div class="third-party-heading-meta">
        <span v-if="table">{{ sourceLabel }}</span>
        <span v-if="table">更新于 {{ formatDateTime(table.updatedAt) }}</span>
      </div>
    </header>

    <nav class="third-party-tabs" aria-label="技术数据分类">
      <button
        v-for="tab in tabs"
        :key="tab.kind"
        :class="{ active: activeKind === tab.kind }"
        type="button"
        @click="selectTab(tab.kind)"
      >
        <component :is="tab.icon" :size="15" />{{ tab.label }}
      </button>
    </nav>

    <div class="batman-toolbar third-party-toolbar">
      <div class="batman-toolbar-start">
        <div v-if="activeKind === 'new_high'" class="third-party-filter-group" aria-label="创新高时间范围">
          <button v-for="option in newHighOptions" :key="option.value" :class="{ active: category === option.value }" type="button" @click="category = option.value">{{ option.label }}</button>
        </div>
        <label v-else-if="hasDayFilter" class="third-party-field">连续天数不少于
          <select v-model.number="days"><option v-for="day in daysOptions" :key="day" :value="day">{{ day }}</option></select>
          天
        </label>
        <label v-else class="third-party-field">交易日期<input v-model="date" type="date" /></label>
      </div>
      <div class="batman-toolbar-end"><button class="batman-button" :disabled="isLoading" type="button" @click="load"><RefreshCw :class="{ spinning: isLoading }" :size="15" />刷新</button></div>
    </div>

    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
    <p v-else-if="table?.notice" class="third-party-notice">{{ table.notice }}</p>

    <div class="batman-table-frame third-party-table-frame" :aria-busy="isLoading">
      <div v-if="isLoading" class="third-party-loading-scrim" role="status" aria-live="polite">
        <RefreshCw class="spinning" :size="18" />
        <span>正在获取{{ activeTab.label }}数据…</span>
      </div>
      <table class="batman-table third-party-table">
        <thead><tr><th>#</th><th v-for="column in columns" :key="column">{{ column }}</th></tr></thead>
        <tbody>
          <tr v-if="isLoading && table === null"><td :colspan="columns.length + 1" class="batman-empty-cell">正在读取{{ activeTab.label }}数据...</td></tr>
          <tr v-else-if="rows.length === 0"><td :colspan="columns.length + 1" class="batman-empty-cell">暂无可展示的数据</td></tr>
          <tr v-for="(row, index) in rows" :key="`${row.values['代码'] ?? row.values['股票代码'] ?? index}`" :class="{ clickable: row.instrument !== null }" @click="openKline(row.instrument)">
            <td>{{ index + 1 }}</td><td v-for="column in columns" :key="column" :title="formatValue(row.values[column] ?? null, column)">{{ formatValue(row.values[column] ?? null, column) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <InstrumentKLineDialog :instrument="selectedInstrument" @close="selectedInstrument = null" />
</template>

<style scoped>
.third-party-technical { max-width: none; }.third-party-heading { align-items: flex-end; display: flex; gap: 20px; justify-content: space-between; margin-bottom: 16px; }.third-party-heading h1 { color: #eff8ff; font-size: 22px; margin: 0; }.third-party-heading p { color: #8ea3b8; font-size: 13px; margin: 6px 0 0; }.third-party-heading-meta { color: #8398ad; display: flex; flex-wrap: wrap; font-size: 12px; gap: 12px; justify-content: flex-end; text-align: right; }.third-party-tabs { border-bottom: 1px solid #2d4059; display: flex; gap: 3px; margin-bottom: 12px; overflow-x: auto; }.third-party-tabs button { align-items: center; background: transparent; border: 0; border-bottom: 2px solid transparent; color: #9cafc1; display: inline-flex; flex: 0 0 auto; font-size: 13px; gap: 6px; min-height: 37px; padding: 0 12px; }.third-party-tabs button:hover { color: #dcebf5; }.third-party-tabs button.active { border-bottom-color: #61d1c5; color: #bffbf4; }.third-party-toolbar { border-bottom: 1px solid #24364c; margin-bottom: 0; padding: 0 0 12px; }.third-party-filter-group { display: inline-flex; }.third-party-filter-group button { background: #172337; border: 1px solid #344b67; color: #aebed0; font-size: 12px; min-height: 30px; padding: 0 10px; }.third-party-filter-group button + button { border-left: 0; }.third-party-filter-group button:first-child { border-radius: 5px 0 0 5px; }.third-party-filter-group button:last-child { border-radius: 0 5px 5px 0; }.third-party-filter-group button.active { background: #236e72; color: #f1fffd; }.third-party-field { align-items: center; color: #aabdd0; display: inline-flex; font-size: 13px; gap: 7px; }.third-party-field input, .third-party-field select { background: #172337; border: 1px solid #384f6a; border-radius: 5px; color: #e5eef7; min-height: 31px; padding: 0 8px; }.third-party-notice { background: #2b271a; border: 1px solid #66592d; color: #e7d58f; font-size: 12px; margin: 12px 0; padding: 8px 10px; }.third-party-table-frame { border-radius: 0 0 7px 7px; min-height: 160px; position: relative; }.third-party-loading-scrim { align-items: flex-start; backdrop-filter: blur(3px); background: rgba(12, 24, 40, 0.74); color: #c9f6f0; display: flex; font-size: 13px; gap: 9px; inset: 0; justify-content: center; padding-top: 14px; position: absolute; z-index: 2; }.third-party-table { min-width: 980px; width: 100%; }.third-party-table th:first-child, .third-party-table td:first-child { text-align: center; width: 46px; }.third-party-table tbody tr.clickable { cursor: pointer; }.third-party-table tbody tr.clickable:hover td { background: #1b3247; color: #eafffb; }@media (max-width: 900px) { .third-party-heading { align-items: flex-start; flex-direction: column; }.third-party-heading-meta { justify-content: flex-start; text-align: left; } }
</style>
