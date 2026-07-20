<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type AlertEvent, type AnalysisTask } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const tasks = ref<AnalysisTask[]>([]); const events = ref<AlertEvent[]>([]);
onMounted(async () => { if (token.value !== null) { const [taskResult, eventResult] = await Promise.all([api.listAnalysisTasks(token.value), api.listAlertEvents(token.value)]); tasks.value = taskResult.items; events.value = eventResult.items; } });
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">自动化</span><h1>执行记录</h1></div></header><div class="details-grid"><section class="data-surface"><h2>分析任务</h2><table><thead><tr><th>状态</th><th>进度</th><th>时间</th></tr></thead><tbody><tr v-for="task in tasks" :key="task.id"><td>{{ task.status }}</td><td>{{ task.progress }}%</td><td>{{ new Date(task.createdAt).toLocaleString() }}</td></tr></tbody></table></section><section class="data-surface"><h2>提醒事件</h2><table><thead><tr><th>内容</th><th>时间</th></tr></thead><tbody><tr v-for="event in events" :key="event.id"><td>{{ event.message }}</td><td>{{ new Date(event.createdAt).toLocaleString() }}</td></tr></tbody></table></section></div></section>
</template>
