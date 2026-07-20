<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import InstrumentSearch from "@/components/InstrumentSearch.vue";
import KLineChart from "@/components/KLineChart.vue";
import { api, ApiError, type IndicatorResult, type IndicatorType, type Instrument, type PriceBar } from "@/api/client";
import { useSession } from "@/stores/session";

const route = useRoute();
const { token } = useSession();
const selected = ref<Instrument | null>(null);
const bars = ref<PriceBar[]>([]);
const source = ref("");
const errorMessage = ref("");
const indicators = ref<IndicatorType[]>(["MA", "BOLL"]);
const results = ref<IndicatorResult[]>([]);

async function loadHistory(refresh = false): Promise<void> {
  if (token.value === null || selected.value === null) return;
  errorMessage.value = "";
  try { const result = await api.calculateIndicators(token.value, selected.value.id, indicators.value, refresh); bars.value = result.bars; source.value = result.source; results.value = result.results; } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "行情加载失败"; }
}

function latest(result: IndicatorResult): string {
  const values = Object.values(result.lines).flat().filter((value): value is number => value !== null);
  const value = values.at(-1);
  return value === undefined ? "-" : value.toFixed(3);
}

onMounted(async () => {
  const instrument = typeof route.query.instrument === "string" ? route.query.instrument : undefined;
  if (instrument === undefined || token.value === null) return;
  const result = await api.searchInstruments(token.value, instrument);
  selected.value = result.items.find((item) => item.code === instrument) ?? null;
  await loadHistory();
});
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">分析</span><h1>技术图表</h1></div><button class="table-button" :disabled="selected === null" type="button" @click="loadHistory(true)">刷新行情</button></header><div class="workspace-form"><InstrumentSearch @select="selected = $event; loadHistory()" /><p v-if="selected" class="selection-note">{{ selected.name }} · 数据源 {{ source || "未加载" }}</p><fieldset class="indicator-switches"><legend>指标</legend><label v-for="type in ['MA', 'MACD', 'RSI', 'BOLL'] as IndicatorType[]" :key="type"><input v-model="indicators" type="checkbox" :value="type" @change="loadHistory()" />{{ type }}</label></fieldset></div><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p><div v-if="bars.length" class="chart-surface"><KLineChart :bars="bars" :indicators="results" :title="`${selected?.name ?? ''} 日线`" /><div class="indicator-summary"><span v-for="result in results" :key="result.type"><strong>{{ result.type }}</strong> {{ latest(result) }}</span></div></div><div v-else class="data-surface muted">选择标的后显示历史行情。</div></section>
</template>
