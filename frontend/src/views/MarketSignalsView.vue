<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type MarketSignal } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession(); const items = ref<MarketSignal[]>([]);
async function load(): Promise<void> { if (token.value !== null) items.value = (await api.marketSignals(token.value)).items; }
onMounted(load);
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">行情</span><h1>技术信号</h1></div><button class="table-button" type="button" @click="load">刷新信号</button></header><section class="data-surface"><table><thead><tr><th>标的</th><th>最新价</th><th>信号</th><th>来源</th></tr></thead><tbody><tr v-for="item in items" :key="item.instrumentId"><td>{{ item.name }} <span class="code">{{ item.code }}</span></td><td>{{ item.price }}</td><td>{{ item.signals.join(" · ") || "无显著信号" }}</td><td>{{ item.source }}</td></tr><tr v-if="items.length === 0"><td colspan="4" class="muted">暂无信号。</td></tr></tbody></table></section></section>
</template>
