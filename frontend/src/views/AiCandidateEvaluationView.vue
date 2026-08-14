<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ArrowLeft, RefreshCw } from "lucide-vue-next";
import { api, ApiError, type AiCandidateEvaluationSummary, type CandidateStrategy } from "@/api/client";
import { useSession } from "@/stores/session";

const strategyTabs: Array<{ value: CandidateStrategy; label: string }> = [
  { value: "trend_event", label: "趋势事件" },
  { value: "quality_growth", label: "质量成长" },
  { value: "value_repair", label: "低估值修复" },
];
const { token } = useSession();
const router = useRouter();
const evaluation = ref<AiCandidateEvaluationSummary | null>(null);
const isLoading = ref(false);
const errorMessage = ref("");

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function formatPercent(value: number | null): string {
  return value === null ? "--" : `${(value * 100).toFixed(2)}%`;
}

async function loadEvaluation(): Promise<void> {
  if (token.value === null) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    evaluation.value = await api.aiCandidateEvaluationSummary(token.value);
  } catch (error) {
    errorMessage.value = message(error, "读取候选评估失败");
  } finally {
    isLoading.value = false;
  }
}

function openCandidates(): void {
  void router.push("/analysis/ai-candidates");
}

onMounted(() => void loadEvaluation());
</script>

<template>
  <section class="batman-workspace ai-candidate-evaluation" aria-label="AI候选效果评估">
    <header class="evaluation-page-header">
      <div class="evaluation-title-group">
        <button class="batman-button evaluation-back-button" type="button" @click="openCandidates"><ArrowLeft :size="15" />返回候选记录</button>
        <h1>效果评估</h1>
      </div>
      <div class="evaluation-actions">
        <button class="batman-button primary" :disabled="isLoading" type="button" @click="loadEvaluation"><RefreshCw :class="{ spinning: isLoading }" :size="15" />刷新评估</button>
      </div>
    </header>
    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
    <section class="evaluation-panel">
      <div class="evaluation-horizon-grid">
        <article v-for="horizon in [5, 10, 20] as const" :key="horizon">
          <span>{{ horizon }} 日</span>
          <strong>{{ evaluation?.horizons[String(horizon) as '5' | '10' | '20']?.matured ?? 0 }} / {{ evaluation?.horizons[String(horizon) as '5' | '10' | '20']?.total ?? 0 }}</strong>
          <small>成熟 / 总样本</small>
          <em>{{ formatPercent(evaluation?.horizons[String(horizon) as '5' | '10' | '20']?.averageNetReturn ?? null) }}</em>
        </article>
      </div>
      <div class="batman-table-frame evaluation-table-frame"><table class="batman-table"><thead><tr><th>策略</th><th>20日样本</th><th>成熟</th><th>命中率</th><th>平均净收益</th></tr></thead><tbody><tr v-for="tab in strategyTabs" :key="tab.value"><td>{{ tab.label }}</td><td>{{ evaluation?.byStrategy[tab.value]?.total ?? 0 }}</td><td>{{ evaluation?.byStrategy[tab.value]?.matured ?? 0 }}</td><td>{{ formatPercent(evaluation?.byStrategy[tab.value]?.hitRate ?? null) }}</td><td>{{ formatPercent(evaluation?.byStrategy[tab.value]?.averageNetReturn ?? null) }}</td></tr></tbody></table></div>
      <p class="evaluation-footnote">历史收益基于下一可执行交易日开盘估算，默认往返成本 20bp；AI 解释和量化排序分开统计。</p>
    </section>
  </section>
</template>

<style scoped>
.ai-candidate-evaluation { max-width: none; }.evaluation-page-header { align-items: center; border-bottom: 1px solid #2b4057; display: flex; justify-content: space-between; margin-bottom: 10px; padding: 2px 0 12px; }.evaluation-title-group { align-items: center; display: flex; gap: 18px; min-width: 0; }.evaluation-page-header h1 { color: #eff8ff; font-size: 23px; margin: 0; }.evaluation-actions { align-items: center; display: flex; gap: 8px; }.evaluation-panel { border: 1px solid #2c425b; background: #111d2c; padding: 12px; }.evaluation-horizon-grid { display: grid; gap: 8px; grid-template-columns: repeat(3, minmax(0, 1fr)); }.evaluation-horizon-grid article { background: #172538; border: 1px solid #2e455e; display: grid; gap: 3px; padding: 11px; }.evaluation-horizon-grid span { color: #8da3b6; font-size: 11px; }.evaluation-horizon-grid strong { color: #e5f2f8; font-size: 17px; }.evaluation-horizon-grid small { color: #788fa4; font-size: 10px; }.evaluation-horizon-grid em { color: #7adfd0; font-size: 13px; font-style: normal; margin-top: 5px; }.evaluation-table-frame { margin-top: 12px; }.evaluation-footnote { color: #7890a5; font-size: 11px; margin: 12px 0 0; }.spinning { animation: evaluation-spin .9s linear infinite; }@keyframes evaluation-spin { to { transform: rotate(360deg); } }@media (max-width: 720px) { .evaluation-page-header { align-items: flex-start; flex-direction: column; gap: 12px; }.evaluation-title-group { align-items: flex-start; flex-wrap: wrap; }.evaluation-actions { width: 100%; }.evaluation-actions .batman-button { flex: 1; }.evaluation-horizon-grid { grid-template-columns: 1fr; } }
</style>
