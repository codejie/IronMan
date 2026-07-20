<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type MarketSignal } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const overview = ref<{ instrumentCount: number; cachedBarCount: number; latestCacheAt: string | null } | null>(null);
const signals = ref<MarketSignal[]>([]);
const groups = ref<Array<{ label: string; links: Array<{ name: string; url: string }> }>>([]);
onMounted(async () => { if (token.value !== null) { const [overviewResult, signalResult, linkResult] = await Promise.all([api.marketOverview(token.value), api.marketSignals(token.value), api.informationLinks(token.value)]); overview.value = overviewResult; signals.value = signalResult.items; groups.value = linkResult.groups; } });
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">行情</span><h1>市场概览</h1></div></header><div v-if="overview" class="metric-grid"><section class="metric-panel"><span>标的库</span><strong>{{ overview.instrumentCount }}</strong></section><section class="metric-panel"><span>缓存 K 线</span><strong>{{ overview.cachedBarCount }}</strong></section><section class="metric-panel"><span>缓存更新时间</span><strong class="metric-date">{{ overview.latestCacheAt ? new Date(overview.latestCacheAt).toLocaleString() : "暂无" }}</strong></section></div><div class="details-grid"><section class="data-surface"><h2>自选信号</h2><p v-if="signals.length === 0" class="muted">暂无信号，先在自选中加载行情。</p><table v-else><thead><tr><th>标的</th><th>价格</th><th>信号</th></tr></thead><tbody><tr v-for="signal in signals" :key="signal.instrumentId"><td>{{ signal.name }} <span class="code">{{ signal.code }}</span></td><td>{{ signal.price }}</td><td>{{ signal.signals.join(" · ") || "-" }}</td></tr></tbody></table></section><section class="data-surface"><h2>资讯链接</h2><div class="link-groups"><section v-for="group in groups" :key="group.label"><h3>{{ group.label }}</h3><a v-for="link in group.links" :key="link.url" :href="link.url" rel="noreferrer" target="_blank">{{ link.name }}</a></section></div></section></div></section>
</template>
