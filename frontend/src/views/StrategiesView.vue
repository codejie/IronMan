<script setup lang="ts">
import { X } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import InstrumentSearch from "@/components/InstrumentSearch.vue";
import { api, ApiError, type IndicatorType, type Instrument, type Strategy } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const strategies = ref<Strategy[]>([]);
const selectedInstruments = ref<Instrument[]>([]);
const name = ref("");
const indicators = ref<IndicatorType[]>(["MA", "RSI"]);
const errorMessage = ref("");
const indicatorOptions: IndicatorType[] = ["MA", "MACD", "RSI", "BOLL"];

async function load(): Promise<void> { if (token.value !== null) strategies.value = (await api.listStrategies(token.value)).items; }
onMounted(load);
function selectInstrument(instrument: Instrument): void { if (!selectedInstruments.value.some((item) => item.id === instrument.id)) selectedInstruments.value.push(instrument); }
async function create(): Promise<void> {
  if (token.value === null) return;
  try { await api.createStrategy(token.value, { name: name.value, instrumentIds: selectedInstruments.value.map((item) => item.id), indicators: indicators.value }); name.value = ""; selectedInstruments.value = []; await load(); } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "策略创建失败"; }
}
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">分析</span><h1>策略方案</h1></div></header><div class="workspace-grid"><section class="workspace-form"><form class="compact-form" @submit.prevent="create"><label>方案名称<input v-model.trim="name" maxlength="120" required /></label><InstrumentSearch @select="selectInstrument" /><div v-if="selectedInstruments.length" class="selected-chips"><span v-for="instrument in selectedInstruments" :key="instrument.id">{{ instrument.name }}<button type="button" :aria-label="`移除 ${instrument.name}`" @click="selectedInstruments = selectedInstruments.filter((item) => item.id !== instrument.id)"><X :size="13" /></button></span></div><fieldset class="indicator-switches"><legend>计算指标</legend><label v-for="type in indicatorOptions" :key="type"><input v-model="indicators" type="checkbox" :value="type" />{{ type }}</label></fieldset><button class="primary-button" :disabled="selectedInstruments.length === 0 || indicators.length === 0" type="submit">创建方案</button></form><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p></section><section class="data-surface"><table><thead><tr><th>方案</th><th>标的数</th><th>指标</th></tr></thead><tbody><tr v-for="strategy in strategies" :key="strategy.id"><td>{{ strategy.name }}</td><td>{{ strategy.instrumentIds.length }}</td><td>{{ strategy.indicators.join(" · ") }}</td></tr><tr v-if="strategies.length === 0"><td colspan="3" class="muted">尚未创建策略方案。</td></tr></tbody></table></section></div></section>
</template>
