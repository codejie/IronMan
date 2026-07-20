<script setup lang="ts">
import { ref } from "vue";
import InstrumentSearch from "@/components/InstrumentSearch.vue";
import { api, ApiError, type AssetType, type Exchange, type Instrument } from "@/api/client";
import { useSession } from "@/stores/session";

const { currentUser, token } = useSession();
const selected = ref<Instrument | null>(null);
const code = ref(""); const name = ref(""); const exchange = ref<Exchange>("sh"); const assetType = ref<AssetType>("stock"); const message = ref("");
async function save(): Promise<void> {
  if (token.value === null) return;
  try { selected.value = await api.upsertInstrument(token.value, { code: code.value, name: name.value, exchange: exchange.value, assetType: assetType.value }); message.value = "标的已保存"; } catch (error) { message.value = error instanceof ApiError ? error.message : "标的保存失败"; }
}
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">行情</span><h1>标的检索</h1></div></header><div class="workspace-grid"><section class="workspace-form"><InstrumentSearch @select="selected = $event" /><p v-if="selected" class="selection-note">{{ selected.name }} · {{ selected.exchange.toUpperCase() }} {{ selected.code }}</p></section><section v-if="currentUser?.role === 'admin'" class="workspace-form"><h2>维护标的</h2><form class="compact-form" @submit.prevent="save"><label>代码<input v-model.trim="code" required /></label><label>名称<input v-model.trim="name" required /></label><label>交易所<select v-model="exchange"><option value="sh">上海</option><option value="sz">深圳</option><option value="bj">北京</option><option value="fund">基金</option></select></label><label>类型<select v-model="assetType"><option value="stock">股票</option><option value="index">指数</option><option value="fund">基金</option></select></label><button class="primary-button" type="submit">保存标的</button></form><p v-if="message" :class="message === '标的已保存' ? 'success-message' : 'form-error'">{{ message }}</p></section></div></section>
</template>
