<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle } from "lucide-vue-next";
import { computed } from "vue";
import type { FundHistoryPoint, FundHistoryState } from "@/api/client";
import { formatDateTime } from "@/utils/date-format";

const props = defineProps<{ state: FundHistoryState; points: FundHistoryPoint[] }>();
const carriedCount = computed(() => props.points.reduce((total, point) => total + point.carriedPriceCount, 0));
const missingCount = computed(() => props.points.reduce((total, point) => total + point.missingPriceCount, 0));
const hasPartial = computed(() => props.points.some((point) => point.dataStatus === "partial"));
const statusLabel = computed(() => {
  if (props.state.status === "dirty") return "待重新计算";
  if (props.state.status === "calculating") return "正在计算";
  if (props.state.status === "failed") return "计算失败";
  if (hasPartial.value) return "部分数据";
  return "已更新";
});
const statusTone = computed(() => props.state.status === "failed" ? "error" : props.state.status === "dirty" || hasPartial.value ? "warning" : props.state.status === "calculating" ? "loading" : "success");
</script>

<template>
  <div :class="['fund-history-status', statusTone]" aria-live="polite">
    <LoaderCircle v-if="state.status === 'calculating'" class="spinning" :size="16" />
    <AlertTriangle v-else-if="state.status === 'dirty' || state.status === 'failed' || hasPartial" :size="16" />
    <CheckCircle2 v-else :size="16" />
    <strong>{{ statusLabel }}</strong>
    <span v-if="state.coveredFrom && state.coveredTo">{{ state.coveredFrom }} 至 {{ state.coveredTo }}</span>
    <span v-else>尚未生成历史数据</span>
    <span><Clock3 :size="13" />{{ formatDateTime(state.updatedAt) }}</span>
    <span v-if="hasPartial">沿用 {{ carriedCount }} · 缺失 {{ missingCount }}</span>
    <RouterLink v-if="state.status === 'dirty' || state.status === 'failed'" to="/system/configuration?section=backup">前往系统配置</RouterLink>
  </div>
</template>

<style scoped>
.fund-history-status { align-items: center; border: 1px solid #31485f; border-radius: 5px; color: #9fb2c5; display: flex; flex-wrap: wrap; font-size: 12px; gap: 8px 14px; min-height: 38px; padding: 7px 11px; }
.fund-history-status strong { color: #deebf4; }
.fund-history-status span { align-items: center; display: inline-flex; gap: 4px; }
.fund-history-status.success { background: #102d2b; border-color: #2d6864; }
.fund-history-status.success > svg, .fund-history-status.success strong { color: #72d9ce; }
.fund-history-status.warning, .fund-history-status.loading { background: #302b1d; border-color: #76653a; }
.fund-history-status.warning > svg, .fund-history-status.warning strong, .fund-history-status.loading > svg { color: #e0bd62; }
.fund-history-status.error { background: #351e26; border-color: #79434e; }
.fund-history-status.error > svg, .fund-history-status.error strong { color: #f08c96; }
.fund-history-status a { color: #77d9d0; margin-left: auto; text-decoration: none; }
.fund-history-status a:hover { text-decoration: underline; }
@media (max-width: 720px) { .fund-history-status a { margin-left: 0; } }
</style>
