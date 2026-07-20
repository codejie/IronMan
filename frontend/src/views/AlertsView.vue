<script setup lang="ts">
import { onMounted, ref } from "vue";
import InstrumentSearch from "@/components/InstrumentSearch.vue";
import { api, ApiError, type AlertEvent, type AlertRule, type Instrument } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const selected = ref<Instrument | null>(null); const alerts = ref<AlertRule[]>([]); const events = ref<AlertEvent[]>([]);
const direction = ref<"above" | "below">("above"); const threshold = ref(""); const cooldownMinutes = ref("60"); const message = ref("");
async function load(): Promise<void> { if (token.value !== null) { const [alertResult, eventResult] = await Promise.all([api.listAlerts(token.value), api.listAlertEvents(token.value)]); alerts.value = alertResult.items; events.value = eventResult.items; } }
onMounted(load);
async function create(): Promise<void> { if (token.value === null || selected.value === null) return; try { await api.createAlert(token.value, { instrumentId: selected.value.id, direction: direction.value, threshold: Number(threshold.value), cooldownMinutes: Number(cooldownMinutes.value) }); selected.value = null; threshold.value = ""; await load(); } catch (error) { message.value = error instanceof ApiError ? error.message : "告警创建失败"; } }
async function evaluate(): Promise<void> { if (token.value === null) return; try { const result = await api.evaluateAlerts(token.value); message.value = `本次触发 ${result.triggered} 条告警`; await load(); } catch (error) { message.value = error instanceof ApiError ? error.message : "告警计算失败"; } }
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">自动化</span><h1>提醒告警</h1></div><button class="table-button" type="button" @click="evaluate">立即评估</button></header><div class="workspace-grid"><section class="workspace-form"><InstrumentSearch @select="selected = $event" /><p v-if="selected" class="selection-note">{{ selected.name }}</p><form class="compact-form" @submit.prevent="create"><label>条件<select v-model="direction"><option value="above">价格高于</option><option value="below">价格低于</option></select></label><label>阈值<input v-model="threshold" type="number" min="0.0001" step="0.001" required /></label><label>冷却分钟<input v-model="cooldownMinutes" type="number" min="1" max="10080" required /></label><button class="primary-button" :disabled="selected === null" type="submit">创建告警</button></form><p v-if="message" class="success-message">{{ message }}</p></section><section class="data-surface"><table><thead><tr><th>规则</th><th>阈值</th><th>冷却</th><th>最近触发</th></tr></thead><tbody><tr v-for="alert in alerts" :key="alert.id"><td>{{ alert.direction === "above" ? "高于" : "低于" }}</td><td>{{ alert.threshold }}</td><td>{{ alert.cooldownMinutes }} 分钟</td><td>{{ alert.lastTriggeredAt ? new Date(alert.lastTriggeredAt).toLocaleString() : "-" }}</td></tr><tr v-if="alerts.length === 0"><td colspan="4" class="muted">尚未创建告警规则。</td></tr></tbody></table></section></div><section class="data-surface event-surface"><h2>触发记录</h2><table><thead><tr><th>时间</th><th>价格</th><th>内容</th></tr></thead><tbody><tr v-for="event in events" :key="event.id"><td>{{ new Date(event.createdAt).toLocaleString() }}</td><td>{{ event.price }}</td><td>{{ event.message }}</td></tr><tr v-if="events.length === 0"><td colspan="3" class="muted">尚无触发记录。</td></tr></tbody></table></section></section>
</template>
