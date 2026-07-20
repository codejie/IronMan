<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api, ApiError, type AnalysisTask, type Strategy } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const strategies = ref<Strategy[]>([]);
const tasks = ref<AnalysisTask[]>([]);
const strategyId = ref("");
const liveTask = ref<AnalysisTask | null>(null);
const errorMessage = ref("");
const logs = ref<Array<{ id: string; level: "info" | "error"; message: string; createdAt: string }>>([]);
const selectedTaskId = ref("");
let stream: EventSource | undefined;

async function load(): Promise<void> { if (token.value !== null) { const [strategiesResult, tasksResult] = await Promise.all([api.listStrategies(token.value), api.listAnalysisTasks(token.value)]); strategies.value = strategiesResult.items; tasks.value = tasksResult.items; } }
onMounted(load);
onBeforeUnmount(() => stream?.close());

function consume(event: Event): void {
  liveTask.value = JSON.parse((event as MessageEvent<string>).data) as AnalysisTask;
  if (liveTask.value.status === "completed" || liveTask.value.status === "failed") { stream?.close(); void load(); }
}

async function start(): Promise<void> {
  if (token.value === null || strategyId.value === "") return;
  try {
    const task = await api.startAnalysis(token.value, strategyId.value);
    liveTask.value = task;
    stream?.close();
    stream = api.streamTask(token.value, task.id);
    ["snapshot", "progress", "completed", "failed"].forEach((eventName) => stream?.addEventListener(eventName, consume));
  } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "无法启动分析任务"; }
}

async function inspect(task: AnalysisTask): Promise<void> {
  if (token.value === null) return;
  selectedTaskId.value = task.id;
  logs.value = (await api.listTaskLogs(token.value, task.id)).items;
}

async function retry(task: AnalysisTask): Promise<void> {
  if (token.value === null) return;
  try { const next = await api.retryAnalysis(token.value, task.id); liveTask.value = next; await load(); } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "任务重试失败"; }
}
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">分析</span><h1>分析任务</h1></div></header><div class="workspace-grid"><section class="workspace-form"><form class="compact-form" @submit.prevent="start"><label>策略方案<select v-model="strategyId" required><option disabled value="">选择策略</option><option v-for="strategy in strategies" :key="strategy.id" :value="strategy.id">{{ strategy.name }}</option></select></label><button class="primary-button" :disabled="strategyId === ''" type="submit">启动分析</button></form><div v-if="liveTask" class="task-progress"><strong>{{ liveTask.status }}</strong><progress :value="liveTask.progress" max="100" /> <span>{{ liveTask.progress }}%</span></div><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p></section><section class="data-surface"><table><thead><tr><th>任务</th><th>状态</th><th>进度</th><th>创建时间</th><th>操作</th></tr></thead><tbody><tr v-for="task in tasks" :key="task.id"><td class="code">{{ task.id.slice(0, 8) }}</td><td>{{ task.status }}</td><td>{{ task.progress }}%</td><td>{{ new Date(task.createdAt).toLocaleString() }}</td><td><button class="table-button" type="button" @click="inspect(task)">日志</button><button v-if="task.status === 'failed' || task.status === 'cancelled'" class="table-button" type="button" @click="retry(task)">重试</button></td></tr><tr v-if="tasks.length === 0"><td colspan="5" class="muted">尚未启动分析任务。</td></tr></tbody></table></section></div><section v-if="selectedTaskId" class="data-surface event-surface"><h2>任务日志</h2><table><thead><tr><th>时间</th><th>级别</th><th>内容</th></tr></thead><tbody><tr v-for="log in logs" :key="log.id"><td>{{ new Date(log.createdAt).toLocaleString() }}</td><td>{{ log.level }}</td><td>{{ log.message }}</td></tr></tbody></table></section></section>
</template>
