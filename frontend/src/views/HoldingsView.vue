<script setup lang="ts">
import { onMounted, ref } from "vue";
import InstrumentSearch from "@/components/InstrumentSearch.vue";
import { api, ApiError, type HoldingSummary, type Instrument } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const selectedInstrument = ref<Instrument | null>(null);
const selectedHolding = ref<HoldingSummary | null>(null);
const holdings = ref<HoldingSummary[]>([]);
const cashAvailable = ref(0);
const quantity = ref(""); const price = ref(""); const fee = ref("0");
const transactionAction = ref<"buy" | "sell">("sell"); const transactionQuantity = ref(""); const transactionPrice = ref(""); const transactionFee = ref("0");
const errorMessage = ref("");
const now = () => new Date().toISOString();

async function load(): Promise<void> { if (token.value !== null) { const result = await api.listHoldings(token.value); holdings.value = result.items; cashAvailable.value = result.cashAvailable; } }
onMounted(load);
async function create(): Promise<void> {
  if (token.value === null || selectedInstrument.value === null) return;
  try { await api.createHolding(token.value, { instrumentId: selectedInstrument.value.id, quantity: Number(quantity.value), price: Number(price.value), fee: Number(fee.value), occurredAt: now() }); selectedInstrument.value = null; quantity.value = ""; price.value = ""; fee.value = "0"; await load(); } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "持仓创建失败"; }
}
async function transact(): Promise<void> {
  if (token.value === null || selectedHolding.value === null) return;
  try { await api.addHoldingTransaction(token.value, { holdingId: selectedHolding.value.id, action: transactionAction.value, quantity: Number(transactionQuantity.value), price: Number(transactionPrice.value), fee: Number(transactionFee.value), occurredAt: now() }); transactionQuantity.value = ""; transactionPrice.value = ""; transactionFee.value = "0"; await load(); } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "交易记录失败"; }
}
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">资产</span><h1>持仓</h1></div><span class="status-tag">可用资金 {{ cashAvailable.toFixed(2) }}</span></header><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p><div class="workspace-grid"><section class="workspace-form"><h2>建立持仓</h2><InstrumentSearch @select="selectedInstrument = $event" /><p v-if="selectedInstrument" class="selection-note">已选择：{{ selectedInstrument.name }}</p><form class="compact-form" @submit.prevent="create"><label>数量<input v-model="quantity" type="number" min="0.0001" step="any" required /></label><label>成交价<input v-model="price" type="number" min="0" step="0.001" required /></label><label>手续费<input v-model="fee" type="number" min="0" step="0.001" required /></label><button class="primary-button" :disabled="selectedInstrument === null" type="submit">记录买入</button></form></section><section class="data-surface"><table><thead><tr><th>标的</th><th>数量</th><th>均价</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="holding in holdings" :key="holding.id"><td>{{ holding.instrument.name }} <span class="code">{{ holding.instrument.code }}</span></td><td>{{ holding.quantity }}</td><td>{{ holding.averageCost.toFixed(3) }}</td><td>{{ holding.status === "active" ? "持有中" : "已清仓" }}</td><td><button class="table-button" type="button" :disabled="holding.status === 'closed'" @click="selectedHolding = holding">交易</button></td></tr><tr v-if="holdings.length === 0"><td colspan="5" class="muted">尚未建立持仓。</td></tr></tbody></table></section></div><section v-if="selectedHolding" class="transaction-band"><h2>{{ selectedHolding.instrument.name }} 交易</h2><form class="transaction-form" @submit.prevent="transact"><label>动作<select v-model="transactionAction"><option value="buy">买入</option><option value="sell">卖出</option></select></label><label>数量<input v-model="transactionQuantity" type="number" min="0.0001" step="any" required /></label><label>成交价<input v-model="transactionPrice" type="number" min="0" step="0.001" required /></label><label>手续费<input v-model="transactionFee" type="number" min="0" step="0.001" required /></label><button class="primary-button" type="submit">记录交易</button></form></section></section>
</template>
