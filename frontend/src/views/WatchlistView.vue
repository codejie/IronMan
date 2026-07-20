<script setup lang="ts">
import { Trash2 } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import InstrumentSearch from "@/components/InstrumentSearch.vue";
import { api, ApiError, type Instrument, type WatchlistEntry } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const router = useRouter();
const items = ref<WatchlistEntry[]>([]);
const selected = ref<Instrument | null>(null);
const note = ref("");
const targetPrice = ref("");
const errorMessage = ref("");
const prices = ref<Record<string, number>>({});
let stream: EventSource | undefined;

async function load(): Promise<void> {
  if (token.value !== null) items.value = (await api.listWatchlist(token.value)).items;
}

onMounted(async () => {
  await load();
  if (token.value === null) return;
  stream = api.streamWatchlist(token.value);
  stream.addEventListener("snapshot", (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { items: Array<{ instrumentId: string; price: number }> };
    prices.value = Object.fromEntries(data.items.map((item) => [item.instrumentId, item.price]));
  });
});
onBeforeUnmount(() => stream?.close());

async function add(): Promise<void> {
  if (token.value === null || selected.value === null) return;
  errorMessage.value = "";
  try {
    await api.createWatchlist(token.value, { instrumentId: selected.value.id, note: note.value, targetPrice: targetPrice.value === "" ? undefined : Number(targetPrice.value) });
    selected.value = null;
    note.value = "";
    targetPrice.value = "";
    await load();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "无法加入自选";
  }
}

async function remove(id: string): Promise<void> {
  if (token.value === null) return;
  await api.deleteWatchlist(token.value, id);
  await load();
}
</script>

<template>
  <section class="page-section">
    <header class="page-header"><div><span class="eyebrow">资产</span><h1>自选</h1></div></header>
    <div class="workspace-grid">
      <section class="workspace-form"><InstrumentSearch @select="selected = $event" /><p v-if="selected" class="selection-note">已选择：{{ selected.name }}（{{ selected.code }}）</p><form class="compact-form" @submit.prevent="add"><label>备注<input v-model.trim="note" maxlength="500" /></label><label>目标价<input v-model="targetPrice" inputmode="decimal" type="number" min="0" step="0.001" /></label><button class="primary-button" :disabled="selected === null" type="submit">加入自选</button></form><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p></section>
      <section class="data-surface"><table><thead><tr><th>标的</th><th>最新价</th><th>目标价</th><th>备注</th><th>操作</th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td><button class="link-button" type="button" @click="router.push({ path: '/analysis/charts', query: { instrument: item.instrument.code } })">{{ item.instrument.name }} <span class="code">{{ item.instrument.code }}</span></button></td><td>{{ prices[item.instrument.id]?.toFixed(3) ?? "-" }}</td><td>{{ item.targetPrice ?? "-" }}</td><td>{{ item.note || "-" }}</td><td><button class="icon-button light" title="移出自选" :aria-label="`移出 ${item.instrument.name}`" type="button" @click="remove(item.id)"><Trash2 :size="16" /></button></td></tr><tr v-if="items.length === 0"><td colspan="5" class="muted">尚无自选标的。</td></tr></tbody></table></section>
    </div>
  </section>
</template>
