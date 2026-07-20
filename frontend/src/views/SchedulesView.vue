<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api, ApiError, type ScheduledJob, type Strategy } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const schedules = ref<ScheduledJob[]>([]); const strategies = ref<Strategy[]>([]);
const name = ref(""); const kind = ref<"analysis" | "alert-scan">("analysis"); const strategyId = ref(""); const intervalMinutes = ref("60"); const errorMessage = ref("");
async function load(): Promise<void> { if (token.value !== null) { const [scheduleResult, strategyResult] = await Promise.all([api.listSchedules(token.value), api.listStrategies(token.value)]); schedules.value = scheduleResult.items; strategies.value = strategyResult.items; } }
onMounted(load); watch(kind, (value) => { if (value === "alert-scan") strategyId.value = ""; });
async function create(): Promise<void> { if (token.value === null) return; try { await api.createSchedule(token.value, { name: name.value, kind: kind.value, intervalMinutes: Number(intervalMinutes.value), strategyId: strategyId.value === "" ? null : strategyId.value }); name.value = ""; await load(); } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "定时任务创建失败"; } }
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">自动化</span><h1>定时任务</h1></div></header><div class="workspace-grid"><section class="workspace-form"><form class="compact-form" @submit.prevent="create"><label>任务名称<input v-model.trim="name" maxlength="120" required /></label><label>任务类型<select v-model="kind"><option value="analysis">策略分析</option><option value="alert-scan">告警扫描</option></select></label><label v-if="kind === 'analysis'">策略方案<select v-model="strategyId"><option value="">不绑定策略</option><option v-for="strategy in strategies" :key="strategy.id" :value="strategy.id">{{ strategy.name }}</option></select></label><label>间隔（分钟）<input v-model="intervalMinutes" min="1" max="10080" type="number" required /></label><button class="primary-button" type="submit">创建定时任务</button></form><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p></section><section class="data-surface"><table><thead><tr><th>名称</th><th>类型</th><th>间隔</th><th>下次执行</th></tr></thead><tbody><tr v-for="schedule in schedules" :key="schedule.id"><td>{{ schedule.name }}</td><td>{{ schedule.kind }}</td><td>{{ schedule.intervalMinutes }} 分钟</td><td>{{ new Date(schedule.nextRunAt).toLocaleString() }}</td></tr><tr v-if="schedules.length === 0"><td colspan="4" class="muted">尚未创建定时任务。</td></tr></tbody></table></section></div></section>
</template>
