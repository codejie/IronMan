<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const value = ref(""); const message = ref("");
onMounted(async () => { if (token.value !== null) value.value = (await api.getTradingCalendar(token.value)).nonTradingDays.join("\n"); });
async function save(): Promise<void> { if (token.value === null) return; const dates = value.value.split(/[\s,]+/).map((date) => date.trim()).filter(Boolean); try { const result = await api.updateTradingCalendar(token.value, dates); value.value = result.nonTradingDays.join("\n"); message.value = "交易日配置已保存"; } catch (error) { message.value = error instanceof ApiError ? error.message : "交易日配置失败"; } }
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">设置</span><h1>交易日</h1></div></header><section class="workspace-form narrow"><form class="compact-form" @submit.prevent="save"><label>非交易日<textarea v-model="value" placeholder="2026-10-01&#10;2026-10-02" /></label><button class="primary-button" type="submit">保存交易日</button></form><p v-if="message" :class="message === '交易日配置已保存' ? 'success-message' : 'form-error'">{{ message }}</p></section></section>
</template>
