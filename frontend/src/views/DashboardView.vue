<script setup lang="ts">
import { Activity, Landmark, Star, WalletCards } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { api, type HoldingSummary, type WatchlistEntry } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const watchlist = ref<WatchlistEntry[]>([]);
const holdings = ref<HoldingSummary[]>([]);
const cash = ref(0);

onMounted(async () => {
  if (token.value === null) return;
  const [watchlistResult, holdingsResult] = await Promise.all([api.listWatchlist(token.value), api.listHoldings(token.value)]);
  watchlist.value = watchlistResult.items;
  holdings.value = holdingsResult.items.filter((holding) => holding.status === "active");
  cash.value = holdingsResult.cashAvailable;
});
</script>

<template>
  <section class="page-section">
    <header class="page-header"><div><span class="eyebrow">概览</span><h1>仪表盘</h1></div></header>
    <div class="metric-grid">
      <section class="metric-panel"><Star :size="21" /><span>自选标的</span><strong>{{ watchlist.length }}</strong></section>
      <section class="metric-panel"><WalletCards :size="21" /><span>活动持仓</span><strong>{{ holdings.length }}</strong></section>
      <section class="metric-panel"><Landmark :size="21" /><span>可用资金</span><strong>{{ cash.toLocaleString("zh-CN", { minimumFractionDigits: 2 }) }}</strong></section>
      <section class="metric-panel"><Activity :size="21" /><span>数据状态</span><strong>就绪</strong></section>
    </div>
    <div class="data-surface dashboard-list">
      <h2>活动持仓</h2>
      <p v-if="holdings.length === 0" class="muted">尚未建立持仓。</p>
      <table v-else><thead><tr><th>标的</th><th>数量</th><th>平均成本</th></tr></thead><tbody><tr v-for="holding in holdings" :key="holding.id"><td>{{ holding.instrument.name }} <span class="code">{{ holding.instrument.code }}</span></td><td>{{ holding.quantity }}</td><td>{{ holding.averageCost.toFixed(3) }}</td></tr></tbody></table>
    </div>
  </section>
</template>
