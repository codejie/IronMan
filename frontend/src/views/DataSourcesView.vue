<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError, type DataSourceConfig } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const config = ref<DataSourceConfig>({ primary: "tencent", fallback: "mock" });
const message = ref("");
onMounted(async () => { if (token.value !== null) config.value = await api.getDataSourceConfig(token.value); });
async function save(): Promise<void> { if (token.value === null) return; try { config.value = await api.updateDataSourceConfig(token.value, config.value); message.value = "数据源配置已保存"; } catch (error) { message.value = error instanceof ApiError ? error.message : "数据源配置失败"; } }
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">设置</span><h1>数据源</h1></div></header><section class="workspace-form narrow"><form class="compact-form" @submit.prevent="save"><label>主数据源<select v-model="config.primary"><option value="tencent">Tencent</option><option value="eastmoney">Eastmoney</option><option value="mock">本地 Mock</option></select></label><label>回退数据源<select v-model="config.fallback"><option value="mock">本地 Mock</option><option value="tencent">Tencent</option><option value="eastmoney">Eastmoney</option></select></label><button class="primary-button" type="submit">保存数据源</button></form><p v-if="message" :class="message === '数据源配置已保存' ? 'success-message' : 'form-error'">{{ message }}</p></section></section>
</template>
