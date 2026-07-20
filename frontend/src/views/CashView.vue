<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const available = ref(0);
const amount = ref("");
const note = ref("");
const errorMessage = ref("");

async function load(): Promise<void> { if (token.value !== null) available.value = (await api.cashSummary(token.value)).available; }
onMounted(load);
async function adjust(): Promise<void> {
  if (token.value === null || amount.value === "") return;
  try { available.value = (await api.adjustCash(token.value, Number(amount.value), note.value)).available; amount.value = ""; note.value = ""; } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "资金调整失败"; }
}
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">资产</span><h1>资金与流水</h1></div></header><div class="workspace-grid"><section class="metric-panel large"><span>可用资金</span><strong>{{ available.toLocaleString("zh-CN", { minimumFractionDigits: 2 }) }}</strong></section><section class="workspace-form"><form class="compact-form" @submit.prevent="adjust"><label>金额<input v-model="amount" inputmode="decimal" type="number" step="0.01" required /></label><label>说明<input v-model.trim="note" maxlength="500" /></label><button class="primary-button" type="submit">记录资金变动</button></form><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p></section></div></section>
</template>
