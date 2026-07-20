<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api, ApiError, type AnalysisTask, type IndicatorResult } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const tasks = ref<AnalysisTask[]>([]);
const selectedTaskId = ref("");
const reports = ref<Array<{ id: string; instrumentId: string; result: { source: string; results: IndicatorResult[] }; createdAt: string }>>([]);
const errorMessage = ref("");
onMounted(async () => { if (token.value !== null) tasks.value = (await api.listAnalysisTasks(token.value)).items.filter((task) => task.status === "completed"); });
watch(selectedTaskId, async (value) => { if (token.value === null || value === "") { reports.value = []; return; } try { reports.value = (await api.listReports(token.value, value)).items; } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "无法读取分析报告"; } });
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">分析</span><h1>分析报告</h1></div></header><section class="workspace-form narrow"><label class="field-label">已完成任务<select v-model="selectedTaskId"><option value="">选择任务</option><option v-for="task in tasks" :key="task.id" :value="task.id">{{ task.id.slice(0, 8) }} · {{ new Date(task.createdAt).toLocaleString() }}</option></select></label></section><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p><div v-if="reports.length" class="report-grid"><section v-for="report in reports" :key="report.id" class="detail-panel"><div><h2>标的 {{ report.instrumentId.slice(0, 8) }}</h2><p>数据源 {{ report.result.source }}</p><div class="indicator-summary"><span v-for="indicator in report.result.results" :key="indicator.type"><strong>{{ indicator.type }}</strong> 已计算</span></div></div></section></div><div v-else class="data-surface muted">选择已完成任务后查看报告。</div></section>
</template>
