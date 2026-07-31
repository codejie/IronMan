<script setup lang="ts">
import { Bell, Check, CheckCircle2, Clock3, Lightbulb, Play, RefreshCw, Settings2, Target, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { api, ApiError, type AlertCondition, type AlertEvent, type AlertRule, type AlertRuleKind, type AlertSettings, type AlertSeverity, type AlertSuggestion } from "@/api/client";
import { requestConfirmation } from "@/components/confirmation";
import { formatDateTime } from "@/utils/date-format";
import { useSession } from "@/stores/session";

type Tab = "events" | "rules" | "suggestions" | "settings";

const { token } = useSession();
const activeTab = ref<Tab>("events");
const events = ref<AlertEvent[]>([]);
const rules = ref<AlertRule[]>([]);
const suggestions = ref<AlertSuggestion[]>([]);
const settings = ref<AlertSettings | null>(null);
const isLoading = ref(false);
const isSaving = ref(false);
const errorMessage = ref("");
const noticeMessage = ref("");
const systemModeDraft = ref<AlertSettings["systemMode"]>("suggest");
const defaultCooldownDraft = ref("60");

const unreadCount = computed(() => events.value.filter((event) => event.status === "unread").length);
const activeRuleCount = computed(() => rules.value.filter((rule) => rule.enabled).length);
const pendingSuggestionCount = computed(() => suggestions.value.filter((suggestion) => suggestion.status === "pending").length);
const latestTrigger = computed(() => events.value[0]?.triggeredAt ?? null);

onMounted(() => {
  void load();
});

async function load(): Promise<void> {
  if (token.value === null) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const [eventResult, ruleResult, suggestionResult, settingsResult] = await Promise.all([
      api.listAlertEvents(token.value),
      api.listAlertRules(token.value),
      api.listAlertSuggestions(token.value, "pending"),
      api.getAlertSettings(token.value)
    ]);
    events.value = eventResult.items;
    rules.value = ruleResult.items;
    suggestions.value = suggestionResult.items;
    settings.value = settingsResult;
    systemModeDraft.value = settingsResult.systemMode;
    defaultCooldownDraft.value = String(settingsResult.defaultCooldownMinutes);
  } catch (error) {
    errorMessage.value = message(error, "读取提醒中心失败");
  } finally {
    isLoading.value = false;
  }
}

async function scan(): Promise<void> {
  if (token.value === null || isSaving.value) return;
  isSaving.value = true;
  errorMessage.value = "";
  try {
    const result = await api.evaluateAlerts(token.value);
    noticeMessage.value = `本次触发 ${result.triggered} 条提醒`;
    await load();
  } catch (error) {
    errorMessage.value = message(error, "扫描提醒失败");
  } finally {
    isSaving.value = false;
  }
}

async function deleteRule(rule: AlertRule): Promise<void> {
  if (token.value === null || isSaving.value) return;
  const confirmed = await requestConfirmation({
    title: "删除提醒规则",
    message: `删除“${rule.name}”后将不再产生新提醒，既有提醒记录会保留。确定删除吗？`,
    confirmLabel: "删除",
    tone: "danger",
  });
  if (!confirmed) return;
  isSaving.value = true;
  errorMessage.value = "";
  try {
    await api.deleteAlertRule(token.value, rule.id);
    noticeMessage.value = "提醒规则已删除";
    await load();
  } catch (error) {
    errorMessage.value = message(error, "删除提醒规则失败");
  } finally {
    isSaving.value = false;
  }
}

async function updateEventStatus(id: string, status: AlertEvent["status"]): Promise<void> {
  if (token.value === null || isSaving.value) return;
  isSaving.value = true;
  errorMessage.value = "";
  try {
    await api.updateAlertEventStatus(token.value, { id, status });
    await load();
  } catch (error) {
    errorMessage.value = message(error, "更新提醒状态失败");
  } finally {
    isSaving.value = false;
  }
}

async function acceptSuggestion(id: string): Promise<void> {
  if (token.value === null || isSaving.value) return;
  isSaving.value = true;
  errorMessage.value = "";
  try {
    await api.acceptAlertSuggestion(token.value, id);
    noticeMessage.value = "系统建议已启用";
    await load();
  } catch (error) {
    errorMessage.value = message(error, "启用系统建议失败");
  } finally {
    isSaving.value = false;
  }
}

async function saveSettings(): Promise<void> {
  if (token.value === null || isSaving.value) return;
  isSaving.value = true;
  errorMessage.value = "";
  try {
    settings.value = await api.updateAlertSettings(token.value, {
      systemMode: systemModeDraft.value,
      defaultCooldownMinutes: Number(defaultCooldownDraft.value),
      quietHours: null
    });
    noticeMessage.value = "提醒设置已保存";
  } catch (error) {
    errorMessage.value = message(error, "保存提醒设置失败");
  } finally {
    isSaving.value = false;
  }
}

function statusLabel(status: AlertEvent["status"]): string {
  if (status === "unread") return "未读";
  if (status === "read") return "已读";
  if (status === "acknowledged") return "已确认";
  if (status === "snoozed") return "稍后";
  return "已处理";
}

function severityLabel(value: AlertSeverity): string {
  if (value === "risk") return "风险";
  if (value === "warning") return "关注";
  return "信息";
}

function ruleKindLabel(kind: AlertRuleKind): string {
  if (kind === "price_threshold") return "价格提醒";
  if (kind === "target_price") return "目标价提醒";
  return "交易计划";
}

function directionLabel(value: "above" | "below" | null): string {
  if (value === "above") return "高于";
  if (value === "below") return "低于";
  return "-";
}

function sourceLabel(value: AlertRule["source"] | AlertSuggestion["source"]): string {
  if (value === "manual") return "手工";
  if (value === "system") return "系统";
  if (value === "trend") return "趋势";
  if (value === "watchlist") return "自选";
  return "持仓";
}

function conditionLabel(condition: AlertCondition): string {
  if ("threshold" in condition) return `${directionLabel(condition.direction)} ${condition.threshold}`;
  if ("targetPrice" in condition) return `${directionLabel(condition.direction)} ${condition.targetPrice}`;
  return `${tradeActionLabel(condition.action)} ${formatDateTime(condition.scheduledAt)}`;
}

function tradeActionLabel(action: "buy" | "sell" | "review" | "note"): string {
  if (action === "buy") return "买入";
  if (action === "sell") return "卖出";
  if (action === "review") return "复盘";
  return "记录";
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

</script>

<template>
  <section class="batman-workspace alert-center">
    <header class="alert-center-heading">
      <div>
        <h1>提醒</h1>
        <p v-if="latestTrigger">最近触发 {{ formatDateTime(latestTrigger) }}</p>
      </div>
      <div class="alert-center-actions">
        <button class="batman-button" :disabled="isLoading" type="button" @click="load"><RefreshCw :class="{ spinning: isLoading }" :size="15" />刷新</button>
        <button aria-label="扫描提醒" class="batman-button primary" :disabled="isSaving" type="button" @click="scan"><Play :size="15" />扫描</button>
      </div>
    </header>

    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
    <p v-else-if="noticeMessage" class="alert-center-notice">{{ noticeMessage }}</p>

    <div class="alert-metrics">
      <div><Bell :size="17" /><span>未读提醒</span><strong>{{ unreadCount }}</strong></div>
      <div><Target :size="17" /><span>启用规则</span><strong>{{ activeRuleCount }}</strong></div>
      <div><Lightbulb :size="17" /><span>待处理建议</span><strong>{{ pendingSuggestionCount }}</strong></div>
      <div><Clock3 :size="17" /><span>默认冷却</span><strong>{{ settings?.defaultCooldownMinutes ?? 60 }}m</strong></div>
    </div>

    <div class="alert-tabs" role="tablist">
      <button :class="{ active: activeTab === 'events' }" aria-label="提醒记录" type="button" @click="activeTab = 'events'">提醒</button>
      <button :class="{ active: activeTab === 'rules' }" aria-label="规则" type="button" @click="activeTab = 'rules'">规则</button>
      <button :class="{ active: activeTab === 'suggestions' }" aria-label="系统建议" type="button" @click="activeTab = 'suggestions'">系统建议</button>
      <button :class="{ active: activeTab === 'settings' }" aria-label="设置" type="button" @click="activeTab = 'settings'"><Settings2 :size="14" />设置</button>
    </div>

    <div v-if="activeTab === 'events'" class="batman-table-frame alert-table-frame">
      <table class="batman-table alert-table">
        <thead><tr><th>级别</th><th>标题</th><th>内容</th><th>状态</th><th>触发时间</th><th class="batman-action-header">操作</th></tr></thead>
        <tbody>
          <tr v-for="event in events" :key="event.id">
            <td><span :class="['alert-severity', event.severity]">{{ severityLabel(event.severity) }}</span></td>
            <td><strong>{{ event.title }}</strong></td>
            <td>{{ event.message }}</td>
            <td>{{ statusLabel(event.status) }}</td>
            <td>{{ formatDateTime(event.triggeredAt) }}</td>
            <td class="batman-actions"><div class="batman-action-controls"><button aria-label="标记提醒为已读" class="batman-icon-button" data-hint="标为已读" data-hint-position="top" :disabled="event.status !== 'unread'" type="button" @click="updateEventStatus(event.id, 'read')"><Check :size="14" /></button><button aria-label="处理提醒" class="batman-icon-button" data-hint="处理提醒" data-hint-position="top" :disabled="event.status === 'resolved'" type="button" @click="updateEventStatus(event.id, 'resolved')"><CheckCircle2 :size="14" /></button></div></td>
          </tr>
          <tr v-if="events.length === 0"><td class="batman-empty-cell" colspan="6">暂无提醒</td></tr>
        </tbody>
      </table>
    </div>

    <div v-else-if="activeTab === 'rules'">
      <div class="batman-table-frame alert-table-frame">
        <table class="batman-table alert-table">
          <thead><tr><th>名称</th><th>类型</th><th>来源</th><th>条件</th><th>级别</th><th>状态</th><th class="batman-action-header">操作</th></tr></thead>
          <tbody>
            <tr v-for="rule in rules" :key="rule.id"><td><strong>{{ rule.name }}</strong></td><td>{{ ruleKindLabel(rule.kind) }}</td><td>{{ sourceLabel(rule.source) }}</td><td>{{ conditionLabel(rule.condition) }}</td><td><span :class="['alert-severity', rule.severity]">{{ severityLabel(rule.severity) }}</span></td><td>{{ rule.enabled ? '启用' : '停用' }}</td><td class="batman-actions"><div class="batman-action-controls"><button :aria-label="`删除规则 ${rule.name}`" class="batman-icon-button alert-rule-delete" data-hint="删除规则" data-hint-position="top" :disabled="isSaving" type="button" @click="deleteRule(rule)"><Trash2 :size="14" /></button></div></td></tr>
            <tr v-if="rules.length === 0"><td class="batman-empty-cell" colspan="7">暂无规则</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-else-if="activeTab === 'suggestions'" class="batman-table-frame alert-table-frame">
      <table class="batman-table alert-table">
        <thead><tr><th>来源</th><th>标题</th><th>建议</th><th>规则</th><th>级别</th><th class="batman-action-header">操作</th></tr></thead>
        <tbody>
          <tr v-for="suggestion in suggestions" :key="suggestion.id"><td>{{ sourceLabel(suggestion.source) }}</td><td><strong>{{ suggestion.title }}</strong></td><td>{{ suggestion.message }}</td><td>{{ ruleKindLabel(suggestion.ruleKind) }} · {{ conditionLabel(suggestion.condition) }}</td><td><span :class="['alert-severity', suggestion.severity]">{{ severityLabel(suggestion.severity) }}</span></td><td class="batman-actions"><div class="batman-action-controls"><button aria-label="启用建议" class="batman-icon-button" data-hint="启用建议" data-hint-position="top" type="button" @click="acceptSuggestion(suggestion.id)"><CheckCircle2 :size="14" /></button></div></td></tr>
          <tr v-if="suggestions.length === 0"><td class="batman-empty-cell" colspan="6">暂无建议</td></tr>
        </tbody>
      </table>
    </div>

    <form v-else aria-label="提醒设置" class="alert-settings-form" @submit.prevent="saveSettings">
      <label>系统自主提醒<select v-model="systemModeDraft" aria-label="系统自主提醒"><option value="off">关闭</option><option value="suggest">建议模式</option><option value="auto">自动模式</option></select></label>
      <label>默认冷却分钟<input v-model="defaultCooldownDraft" aria-label="默认冷却分钟" min="1" step="1" type="number" /></label>
      <button class="batman-button primary" :disabled="isSaving" type="submit">保存设置</button>
    </form>
  </section>
</template>

<style scoped>
.alert-center { max-width: none; }
.alert-center-heading { align-items: flex-end; display: flex; gap: 18px; justify-content: space-between; margin-bottom: 12px; }
.alert-center-heading h1 { color: #eff8ff; font-size: 22px; margin: 0; }
.alert-center-heading p { color: #8ea3b8; font-size: 12px; margin: 5px 0 0; }
.alert-center-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.alert-center-notice { background: #122c2a; border: 1px solid #2e706a; border-radius: 6px; color: #9df1e6; font-size: 12px; margin: 0 0 12px; padding: 8px 10px; }
.alert-metrics { display: grid; gap: 8px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 12px; }
.alert-metrics > div { align-items: center; background: #111b2d; border: 1px solid #2c4059; border-radius: 7px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; min-height: 54px; padding: 9px 11px; }
.alert-metrics svg { color: #67d6cb; }
.alert-metrics span { color: #96aabe; font-size: 12px; }
.alert-metrics strong { color: #f1f8ff; font-size: 18px; }
.alert-tabs { border-bottom: 1px solid #2d4059; display: flex; gap: 3px; margin-bottom: 12px; overflow-x: auto; }
.alert-tabs button { align-items: center; background: transparent; border: 0; border-bottom: 2px solid transparent; color: #9cafc1; display: inline-flex; flex: 0 0 auto; font-size: 13px; gap: 6px; min-height: 37px; padding: 0 12px; }
.alert-tabs button.active { border-bottom-color: #61d1c5; color: #c9fff8; }
.alert-table { min-width: 960px; width: 100%; }
.alert-table th, .alert-table td { padding-bottom: 7px; padding-top: 7px; }
.alert-table td strong { color: #eff8ff; }
.alert-severity { border-radius: 999px; display: inline-flex; font-size: 11px; justify-content: center; min-width: 42px; padding: 2px 7px; }
.alert-severity.info { background: #173354; color: #a7d2ff; }
.alert-severity.warning { background: #3a311b; color: #efd182; }
.alert-severity.risk { background: #4a2028; color: #ffabb5; }
.alert-settings-form { background: #111b2d; border: 1px solid #2c4059; border-radius: 7px; display: grid; gap: 10px; padding: 12px; }
.alert-settings-form label { color: #9dafc3; display: grid; font-size: 12px; gap: 5px; }
.alert-settings-form input, .alert-settings-form select { background: #162236; border: 1px solid #344963; border-radius: 5px; color: #e8f1fa; min-height: 31px; padding: 0 8px; }
.alert-rule-delete { color: #9eafc1; }
.alert-rule-delete:hover:not(:disabled) { background: #3a2028; color: #ff9fa8; }
.alert-settings-form { align-items: end; grid-template-columns: minmax(180px, 240px) minmax(160px, 220px) auto; max-width: 760px; }
@media (max-width: 900px) {
  .alert-center-heading { align-items: flex-start; flex-direction: column; }
  .alert-metrics, .alert-settings-form { grid-template-columns: 1fr; }
}
</style>
