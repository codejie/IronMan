<script setup lang="ts">
import {
  ArrowLeft,
  ChevronDown,
  Info,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import InstrumentSearch from "@/components/InstrumentSearch.vue";
import { requestConfirmation } from "@/components/confirmation";
import {
  api,
  ApiError,
  type Instrument,
  type TrendDateRange,
  type TrendIndicatorDefinition,
  type TrendReportWindow,
  type TrendStrategy,
  type TrendStrategyTarget,
  type TrendTargetScope,
} from "@/api/client";
import { useSession } from "@/stores/session";

type StrategyDraft = Omit<TrendStrategy, "id" | "createdAt" | "updatedAt">;
type IndicatorCategory =
  | "overlap"
  | "momentum"
  | "volatility"
  | "volume"
  | "price"
  | "pattern"
  | "cycle";

const indicatorCategories: Array<{
  id: IndicatorCategory;
  label: string;
  description: string;
  initiallyExpanded: boolean;
}> = [
  {
    id: "overlap",
    label: "覆盖研究",
    description: "价格主图与趋势参考",
    initiallyExpanded: true,
  },
  {
    id: "momentum",
    label: "动量指标",
    description: "趋势速度与多空力量",
    initiallyExpanded: true,
  },
  {
    id: "volatility",
    label: "波动率指标",
    description: "价格区间与波动风险",
    initiallyExpanded: true,
  },
  {
    id: "volume",
    label: "成交量指标",
    description: "量能与资金流向",
    initiallyExpanded: false,
  },
  {
    id: "price",
    label: "价格变换",
    description: "价格基准与平滑参考",
    initiallyExpanded: false,
  },
  {
    id: "pattern",
    label: "K线形态识别",
    description: "常见反转与延续形态",
    initiallyExpanded: false,
  },
  {
    id: "cycle",
    label: "周期指标",
    description: "主导周期与相位变化",
    initiallyExpanded: false,
  },
];

const scopeOptions: Array<{ value: TrendTargetScope; label: string }> = [
  { value: "holdings", label: "持仓记录" },
  { value: "watchlist", label: "自选列表" },
  { value: "holdings_watchlist", label: "持仓 + 自选" },
  { value: "custom", label: "自定义标的" },
  { value: "all", label: "全市场" },
];
const rangeOptions: Array<{ value: TrendDateRange["preset"]; label: string }> =
  [
    { value: "3m", label: "3个月" },
    { value: "6m", label: "6个月" },
    { value: "1y", label: "1年" },
    { value: "2y", label: "2年" },
    { value: "custom", label: "自定义" },
  ];
const reportWindowOptions: Array<{ value: TrendReportWindow; label: string }> =
  [
    { value: "1d", label: "1天" },
    { value: "3d", label: "3天" },
    { value: "7d", label: "7天" },
    { value: "30d", label: "30天" },
    { value: "all", label: "全部" },
  ];

const route = useRoute();
const router = useRouter();
const { token } = useSession();
const catalog = ref<TrendIndicatorDefinition[]>([]);
const originalStrategy = ref<TrendStrategy | null>(null);
const draft = ref<StrategyDraft>(emptyDraft());
const targetRows = ref<TrendStrategyTarget[]>([]);
const customTargets = ref<TrendStrategyTarget[]>([]);
const expandedCategories = ref<Set<IndicatorCategory>>(new Set());
const expandedDetails = ref<Set<string>>(new Set());
const isLoading = ref(true);
const isSaving = ref(false);
const isLoadingTargets = ref(false);
const errorMessage = ref("");
let targetLoadVersion = 0;

const strategyId = computed(() =>
  typeof route.params.id === "string" ? route.params.id : null,
);
const isEditing = computed(() => strategyId.value !== null);
const selectedIndicatorIds = computed(
  () =>
    new Set(
      draft.value.indicators
        .filter((indicator) => indicator.enabled !== false)
        .map((indicator) => indicator.indicatorId),
    ),
);
const selectedCatalog = computed(() =>
  catalog.value.filter((definition) =>
    selectedIndicatorIds.value.has(definition.id),
  ),
);
const indicatorGroups = computed(() =>
  indicatorCategories
    .map((category) => ({
      ...category,
      definitions: catalog.value.filter(
        (definition) => definition.category === category.id,
      ),
    }))
    .filter((group) => group.definitions.length > 0),
);
const displayedTargets = computed(() =>
  draft.value.targetScope === "custom" ? customTargets.value : targetRows.value,
);

function emptyDraft(): StrategyDraft {
  return {
    name: "",
    remarks: "",
    targetScope: "holdings_watchlist",
    dataRange: { preset: "6m" },
    reportWindow: "7d",
    backtestConfig: null,
    customInstrumentIds: [],
    indicators: [
      {
        indicatorId: "MA",
        parameters: { period: 20 },
        enabled: true,
        displayOrder: 0,
      },
      {
        indicatorId: "MACD",
        parameters: { fast: 12, slow: 26, signal: 9 },
        enabled: true,
        displayOrder: 1,
      },
    ],
  };
}

function cloneDraft(strategy: TrendStrategy): StrategyDraft {
  return {
    name: strategy.name,
    remarks: strategy.remarks,
    targetScope: strategy.targetScope,
    dataRange: { ...strategy.dataRange },
    reportWindow: strategy.reportWindow,
    backtestConfig: strategy.backtestConfig,
    customInstrumentIds: [...strategy.customInstrumentIds],
    indicators: strategy.indicators.map((indicator) => ({
      ...indicator,
      parameters: { ...indicator.parameters },
    })),
  };
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
function typeLabel(
  type: TrendStrategyTarget["instrument"]["assetType"],
): string {
  return type === "stock" ? "股票" : type === "index" ? "指数" : "基金";
}
function priceLabel(value: number | null): string {
  return value === null ? "--" : value.toFixed(value < 10 ? 4 : 2);
}
function selectedIndicator(
  id: string,
): TrendStrategy["indicators"][number] | undefined {
  return draft.value.indicators.find(
    (indicator) => indicator.indicatorId === id,
  );
}
function chartLabel(definition: TrendIndicatorDefinition): string {
  return definition.chart === "main"
    ? "主图"
    : definition.chart === "sub"
      ? "副图"
      : "形态识别";
}
function parameterSummary(definition: TrendIndicatorDefinition): string {
  return definition.parameters.length === 0
    ? "无额外参数"
    : definition.parameters
        .map(
          (parameter) => `${parameter.label} ${parameter.min}-${parameter.max}`,
        )
        .join(" · ");
}
function indicatorAdvice(definition: TrendIndicatorDefinition): string {
  return definition.usageHint.trim() || definition.description;
}
function indicatorDetail(
  definition: TrendIndicatorDefinition,
): TrendIndicatorDefinition["detail"] {
  return {
    meaning: definition.detail?.meaning?.trim() || definition.description,
    usage: definition.detail?.usage?.trim() || indicatorAdvice(definition),
    trend: definition.detail?.trend?.trim() || indicatorAdvice(definition),
  };
}
function indicatorAbbreviations(
  definitions: TrendIndicatorDefinition[],
): string {
  return definitions.map((definition) => definition.id).join(" · ");
}
function resetExpandedCategories(): void {
  expandedCategories.value = new Set(
    indicatorCategories
      .filter((category) => category.initiallyExpanded)
      .map((category) => category.id),
  );
  for (const definition of selectedCatalog.value) {
    expandedCategories.value.add(definition.category as IndicatorCategory);
  }
  expandedDetails.value = new Set();
}
function isExpanded(category: IndicatorCategory): boolean {
  return expandedCategories.value.has(category);
}
function toggleCategory(category: IndicatorCategory): void {
  const next = new Set(expandedCategories.value);
  if (next.has(category)) next.delete(category);
  else next.add(category);
  expandedCategories.value = next;
}
function toggleDetails(indicatorId: string): void {
  const next = new Set(expandedDetails.value);
  if (next.has(indicatorId)) next.delete(indicatorId);
  else next.add(indicatorId);
  expandedDetails.value = next;
}
function expandAll(): void {
  expandedCategories.value = new Set(
    indicatorGroups.value.map((group) => group.id),
  );
}
function collapseAll(): void {
  expandedCategories.value = new Set();
}
function toggleIndicator(definition: TrendIndicatorDefinition): void {
  const index = draft.value.indicators.findIndex(
    (indicator) => indicator.indicatorId === definition.id,
  );
  if (index >= 0) {
    draft.value.indicators.splice(index, 1);
    return;
  }
  draft.value.indicators.push({
    indicatorId: definition.id,
    parameters: Object.fromEntries(
      definition.parameters.map((parameter) => [
        parameter.key,
        parameter.defaultValue,
      ]),
    ),
    enabled: true,
    displayOrder: draft.value.indicators.length,
  });
}

function toTarget(
  instrument: TrendStrategyTarget["instrument"],
  currentPrice: number | null,
): TrendStrategyTarget {
  return { instrument, currentPrice };
}
function dedupeTargets(items: TrendStrategyTarget[]): TrendStrategyTarget[] {
  return [...new Map(items.map((item) => [item.instrument.id, item])).values()];
}
async function loadScopeTargets(): Promise<void> {
  if (token.value === null) return;
  const version = ++targetLoadVersion;
  const scope = draft.value.targetScope;
  if (scope === "all") {
    targetRows.value = [];
    return;
  }
  if (scope === "custom") {
    if (
      originalStrategy.value?.targetScope === "custom" &&
      customTargets.value.length === 0
    ) {
      isLoadingTargets.value = true;
      try {
        const result = await api.listTrendStrategyTargets(
          token.value,
          originalStrategy.value.id,
        );
        if (version === targetLoadVersion) {
          customTargets.value = result.items;
          draft.value.customInstrumentIds = result.items.map(
            (item) => item.instrument.id,
          );
        }
      } catch (error) {
        if (version === targetLoadVersion)
          errorMessage.value = message(error, "读取自定义标的失败");
      } finally {
        if (version === targetLoadVersion) isLoadingTargets.value = false;
      }
    }
    return;
  }
  isLoadingTargets.value = true;
  try {
    const [holdings, watchlist] = await Promise.all([
      scope === "holdings" || scope === "holdings_watchlist"
        ? api.batmanHoldingWorkspace(token.value)
        : Promise.resolve(null),
      scope === "watchlist" || scope === "holdings_watchlist"
        ? api.watchlistWorkspace(token.value)
        : Promise.resolve(null),
    ]);
    if (version !== targetLoadVersion) return;
    targetRows.value = dedupeTargets([
      ...(holdings?.active.map((holding) =>
        toTarget(holding.instrument, holding.currentPrice),
      ) ?? []),
      ...(watchlist?.items.map((item) =>
        toTarget(item.instrument, item.latestPrice),
      ) ?? []),
    ]);
  } catch (error) {
    if (version === targetLoadVersion)
      errorMessage.value = message(error, "读取策略范围失败");
  } finally {
    if (version === targetLoadVersion) isLoadingTargets.value = false;
  }
}
function setTargetScope(scope: TrendTargetScope): void {
  if (draft.value.targetScope === scope) return;
  draft.value.targetScope = scope;
  errorMessage.value = "";
  void loadScopeTargets();
}
function addCustomTarget(instrument: Instrument): void {
  if (draft.value.customInstrumentIds.includes(instrument.id)) return;
  draft.value.customInstrumentIds.push(instrument.id);
  customTargets.value = [
    ...customTargets.value,
    toTarget(
      {
        id: instrument.id,
        code: instrument.code,
        exchange: instrument.exchange,
        name: instrument.name,
        assetType: instrument.assetType,
      },
      null,
    ),
  ];
}
function removeCustomTarget(instrumentId: string): void {
  draft.value.customInstrumentIds = draft.value.customInstrumentIds.filter(
    (id) => id !== instrumentId,
  );
  customTargets.value = customTargets.value.filter(
    (item) => item.instrument.id !== instrumentId,
  );
}

async function loadEditor(): Promise<void> {
  if (token.value === null) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const [catalogResult, strategy] = await Promise.all([
      api.trendIndicatorCatalog(token.value),
      strategyId.value === null
        ? Promise.resolve(null)
        : api.getTrendStrategy(token.value, strategyId.value),
    ]);
    catalog.value = catalogResult.items;
    originalStrategy.value = strategy;
    draft.value = strategy === null ? emptyDraft() : cloneDraft(strategy);
    resetExpandedCategories();
    await loadScopeTargets();
  } catch (error) {
    errorMessage.value = message(error, "加载趋势策略失败");
  } finally {
    isLoading.value = false;
  }
}
async function saveStrategy(): Promise<void> {
  if (token.value === null || isSaving.value) return;
  if (draft.value.name.trim() === "") {
    errorMessage.value = "请填写策略名称";
    return;
  }
  if (
    draft.value.indicators.filter((indicator) => indicator.enabled !== false)
      .length === 0
  ) {
    errorMessage.value = "请至少选择一个指标";
    return;
  }
  if (
    draft.value.targetScope === "custom" &&
    draft.value.customInstrumentIds.length === 0
  ) {
    errorMessage.value = "请至少添加一个自定义标的";
    return;
  }
  isSaving.value = true;
  errorMessage.value = "";
  try {
    const saved =
      originalStrategy.value === null
        ? await api.createTrendStrategy(token.value, draft.value)
        : await api.updateTrendStrategy(token.value, {
            ...draft.value,
            id: originalStrategy.value.id,
            createdAt: originalStrategy.value.createdAt,
            updatedAt: originalStrategy.value.updatedAt,
          });
    await router.replace({
      path: "/analysis/trend",
      query: { strategyId: saved.id },
    });
  } catch (error) {
    errorMessage.value = message(error, "保存趋势策略失败");
  } finally {
    isSaving.value = false;
  }
}
async function deleteStrategy(): Promise<void> {
  if (token.value === null || originalStrategy.value === null || isSaving.value)
    return;
  const confirmed = await requestConfirmation({
    title: "删除趋势策略",
    message: `删除“${originalStrategy.value.name}”后，对应运行记录和报告也会移除。确定继续吗？`,
    confirmLabel: "删除",
    tone: "danger",
  });
  if (!confirmed) return;
  isSaving.value = true;
  try {
    await api.deleteTrendStrategy(token.value, originalStrategy.value.id);
    await router.replace("/analysis/trend");
  } catch (error) {
    errorMessage.value = message(error, "删除趋势策略失败");
  } finally {
    isSaving.value = false;
  }
}
function goBack(): void {
  void router.push("/analysis/trend");
}

onMounted(() => {
  void loadEditor();
});
</script>

<template>
  <section class="trend-strategy-editor">
    <header class="strategy-editor-header">
      <button class="batman-button" type="button" @click="goBack">
        <ArrowLeft :size="15" />返回趋势计算
      </button>
      <div>
        <h1>{{ isEditing ? "编辑趋势策略" : "新建趋势策略" }}</h1>
      </div>
      <div class="strategy-editor-actions">
        <button
          v-if="isEditing"
          class="batman-button danger"
          :disabled="isSaving"
          type="button"
          @click="deleteStrategy"
        >
          <Trash2 :size="15" />删除
        </button>
        <button
          class="batman-button primary"
          :disabled="isSaving"
          type="button"
          @click="saveStrategy"
        >
          <Save :size="15" />{{ isSaving ? "保存中" : "保存策略" }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
    <div v-if="isLoading" class="strategy-editor-loading">
      <LoaderCircle :size="18" />正在加载策略编辑器...
    </div>

    <div v-else class="strategy-editor-layout">
      <aside class="strategy-settings-column">
        <section class="strategy-panel strategy-config-panel">
          <header><strong>策略配置</strong><span>基础信息</span></header>
          <label
            >策略名称<input
              v-model.trim="draft.name"
              maxlength="120"
              placeholder="例如：持仓趋势观察"
          /></label>
          <label
            >备注<textarea
              v-model.trim="draft.remarks"
              maxlength="1000"
              placeholder="记录这套策略的使用场景"
            />
          </label>
        </section>

        <section class="strategy-panel strategy-data-panel">
          <header><strong>数据与报告</strong><span>计算口径</span></header>
          <label
            >行情跨度<select v-model="draft.dataRange.preset">
              <option
                v-for="option in rangeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select></label
          >
          <div
            v-if="draft.dataRange.preset === 'custom'"
            class="strategy-date-inputs"
          >
            <input v-model="draft.dataRange.startDate" type="date" /><span
              >至</span
            ><input v-model="draft.dataRange.endDate" type="date" />
          </div>
          <label
            >报告窗口<select v-model="draft.reportWindow">
              <option
                v-for="option in reportWindowOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select></label
          >
        </section>

        <section class="strategy-panel strategy-target-panel">
          <header>
            <div><strong>标的范围</strong><span>计算对象</span></div>
            <small v-if="draft.targetScope !== 'all'"
              >{{ displayedTargets.length }} 个标的</small
            >
          </header>
          <div class="strategy-scope-tabs">
            <button
              v-for="option in scopeOptions"
              :key="option.value"
              :class="{ active: draft.targetScope === option.value }"
              type="button"
              @click="setTargetScope(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
          <p v-if="draft.targetScope === 'all'" class="strategy-all-targets">
            全市场将在开始计算时根据可用行情确定，保存时不展开具体标的。
          </p>
          <template v-else>
            <div
              v-if="draft.targetScope === 'custom'"
              class="strategy-target-search"
            >
              <InstrumentSearch @select="addCustomTarget" />
            </div>
            <div class="strategy-target-list">
              <p v-if="isLoadingTargets" class="strategy-target-state">
                <LoaderCircle :size="14" />正在读取标的...
              </p>
              <p
                v-else-if="displayedTargets.length === 0"
                class="strategy-target-state"
              >
                {{
                  draft.targetScope === "custom"
                    ? "请检索并添加至少一个标的"
                    : "当前范围没有可用标的"
                }}
              </p>
              <table v-else>
                <thead>
                  <tr>
                    <th>名称/代码</th>
                    <th>当前价格</th>
                    <th v-if="draft.targetScope === 'custom'" />
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="item in displayedTargets"
                    :key="item.instrument.id"
                  >
                    <td>
                      <strong>{{ item.instrument.name }}</strong
                      ><span
                        >{{ item.instrument.code }} [{{
                          typeLabel(item.instrument.assetType)
                        }}]</span
                      >
                    </td>
                    <td>{{ priceLabel(item.currentPrice) }}</td>
                    <td v-if="draft.targetScope === 'custom'">
                      <button
                        :aria-label="`移除 ${item.instrument.name}`"
                        class="strategy-target-remove"
                        type="button"
                        @click="removeCustomTarget(item.instrument.id)"
                      >
                        <Trash2 :size="13" />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </section>
      </aside>

      <main class="strategy-indicator-column">
        <section class="strategy-panel strategy-library-panel">
          <header>
            <div>
              <strong>指标库</strong>
            </div>
            <div class="strategy-library-actions">
              <span>{{ selectedIndicatorIds.size }} 项已选</span
              ><button type="button" @click="expandAll">展开全部</button
              ><button type="button" @click="collapseAll">收起全部</button>
            </div>
          </header>
          <div class="strategy-indicator-groups" aria-label="趋势指标目录">
            <section
              v-for="group in indicatorGroups"
              :key="group.id"
              class="strategy-indicator-group"
            >
              <header>
                <button
                  :aria-expanded="isExpanded(group.id)"
                  :aria-label="`${isExpanded(group.id) ? '收起' : '展开'}${group.label}`"
                  class="strategy-category-toggle"
                  type="button"
                  @click="toggleCategory(group.id)"
                >
                  <ChevronDown
                    :class="{ collapsed: !isExpanded(group.id) }"
                    :size="15"
                  /><span class="strategy-category-title"
                    ><strong>{{ group.label }}</strong
                    ><span
                      >[<code>{{
                        indicatorAbbreviations(group.definitions)
                      }}</code
                      >]: {{ group.description }}</span
                    ></span
                  >
                </button>
              </header>
              <div
                v-show="isExpanded(group.id)"
                class="strategy-indicator-items"
              >
                <article
                  v-for="definition in group.definitions"
                  :key="definition.id"
                  :class="{ active: selectedIndicatorIds.has(definition.id) }"
                >
                  <button
                    :aria-label="`${selectedIndicatorIds.has(definition.id) ? '移除' : '添加'} ${definition.id}`"
                    :class="{ active: selectedIndicatorIds.has(definition.id) }"
                    class="strategy-indicator-select"
                    type="button"
                    @click="toggleIndicator(definition)"
                  >
                    {{
                      selectedIndicatorIds.has(definition.id) ? "移除" : "添加"
                    }}
                  </button>
                  <div>
                    <strong
                      >{{ definition.label }}
                      <code>{{ definition.id }}</code></strong
                    ><span>{{ definition.description }}</span>
                  </div>
                  <em>{{ chartLabel(definition) }}</em>
                  <button
                    :aria-expanded="expandedDetails.has(definition.id)"
                    :aria-label="`查看 ${definition.id} 指标说明`"
                    class="strategy-indicator-info"
                    type="button"
                    @click="toggleDetails(definition.id)"
                  >
                    <Info :size="14" />
                  </button>
                  <div
                    v-if="expandedDetails.has(definition.id)"
                    class="strategy-indicator-details"
                  >
                    <p>{{ definition.usageHint }}</p>
                    <dl>
                      <div>
                        <dt>意义</dt>
                        <dd>{{ indicatorDetail(definition).meaning }}</dd>
                      </div>
                      <div>
                        <dt>用法</dt>
                        <dd>{{ indicatorDetail(definition).usage }}</dd>
                      </div>
                      <div>
                        <dt>趋势判断</dt>
                        <dd>{{ indicatorDetail(definition).trend }}</dd>
                      </div>
                    </dl>
                    <small>参数：{{ parameterSummary(definition) }}</small>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </section>

        <section class="strategy-panel strategy-parameter-panel">
          <header>
            <strong>已选指标</strong
            ><span>{{
              selectedCatalog.length
                ? "修改参数后会随策略保存"
                : "从指标库添加后可配置参数"
            }}</span>
          </header>
          <p
            v-if="selectedCatalog.length === 0"
            class="strategy-empty-parameters"
          >
            尚未选择指标。
          </p>
          <div v-else class="strategy-parameter-list">
            <article v-for="definition in selectedCatalog" :key="definition.id">
              <div>
                <strong
                  >{{ definition.label }}
                  <code>{{ definition.id }}</code></strong
                >
              </div>
              <label
                v-for="parameter in definition.parameters"
                :key="parameter.key"
                >{{ parameter.label
                }}<input
                  v-model.number="
                    selectedIndicator(definition.id)!.parameters[parameter.key]
                  "
                  :max="parameter.max"
                  :min="parameter.min"
                  :step="parameter.step ?? 1"
                  type="number"
              /></label>
              <small v-if="definition.parameters.length === 0"
                >使用默认计算参数</small
              >
              <p
                class="strategy-parameter-advice"
                :title="indicatorAdvice(definition)"
              >
                关注：{{ indicatorAdvice(definition) }}
              </p>
              <button
                :aria-label="`从策略中移除 ${definition.id}`"
                class="strategy-parameter-remove"
                title="移除指标"
                type="button"
                @click="toggleIndicator(definition)"
              >
                <Trash2 :size="14" />
              </button>
            </article>
          </div>
        </section>
      </main>
    </div>
  </section>
</template>

<style scoped>
.trend-strategy-editor {
  display: grid;
  gap: 12px;
  min-height: calc(100dvh - 112px);
}
.strategy-editor-header {
  align-items: center;
  border-bottom: 1px solid #293e58;
  display: grid;
  gap: 14px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: 0 0 12px;
}
.strategy-editor-header h1 {
  color: #eff7ff;
  font-size: 19px;
  margin: 0;
}
.strategy-editor-actions {
  display: flex;
  gap: 8px;
}
.strategy-editor-loading {
  align-items: center;
  color: #9fb6ca;
  display: flex;
  font-size: 12px;
  gap: 8px;
  justify-content: center;
  min-height: 420px;
}
.strategy-editor-loading svg {
  animation: strategy-spin 0.9s linear infinite;
}
.strategy-editor-layout {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(260px, 26fr) minmax(0, 74fr);
  min-height: 0;
}
.strategy-settings-column,
.strategy-indicator-column {
  display: grid;
  gap: 12px;
  min-height: 0;
}
.strategy-settings-column {
  grid-template-rows: auto auto minmax(260px, 1fr);
}
.strategy-indicator-column {
  grid-template-rows: auto minmax(320px, 1fr);
}
.strategy-panel {
  background: #0f1b2d;
  border: 1px solid #29425d;
  border-radius: 7px;
  min-width: 0;
  padding: 12px;
}
.strategy-panel > header {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}
.strategy-panel > header strong {
  color: #e3f0f9;
  display: block;
  font-size: 13px;
}
.strategy-panel > header span,
.strategy-panel > header small {
  color: #829ab2;
  display: block;
  font-size: 10px;
  margin-top: 2px;
}
.strategy-config-panel {
  display: grid;
  gap: 9px;
}
.strategy-config-panel label,
.strategy-data-panel label {
  color: #aabfd2;
  display: grid;
  font-size: 11px;
  font-weight: 650;
  gap: 5px;
}
.strategy-config-panel input,
.strategy-config-panel textarea,
.strategy-data-panel select,
.strategy-date-inputs input,
.strategy-parameter-list input {
  background: #19283b;
  border: 1px solid #3b5370;
  border-radius: 4px;
  color: #eff7ff;
  font: inherit;
  min-height: 30px;
  padding: 0 8px;
}
.strategy-config-panel textarea {
  min-height: 52px;
  padding: 7px 8px;
  resize: vertical;
}
.strategy-data-panel {
  display: grid;
  gap: 9px;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.strategy-data-panel header {
  grid-column: 1 / -1;
  margin-bottom: 0;
}
.strategy-date-inputs {
  align-items: center;
  display: flex;
  gap: 5px;
  grid-column: 1 / -1;
}
.strategy-date-inputs input {
  min-width: 0;
  width: 100%;
}
.strategy-date-inputs span {
  color: #7f98ae;
  font-size: 11px;
}
.strategy-target-panel {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  min-height: 0;
}
.strategy-scope-tabs {
  display: flex;
  flex-wrap: wrap;
  margin: -2px 0 9px;
}
.strategy-scope-tabs button {
  background: #17263a;
  border: 1px solid #334b67;
  color: #aac0d3;
  cursor: pointer;
  font-size: 10px;
  margin: -1px 0 0 -1px;
  min-height: 27px;
  padding: 0 7px;
}
.strategy-scope-tabs button:first-child {
  border-radius: 4px 0 0 4px;
  margin-left: 0;
}
.strategy-scope-tabs button:last-child {
  border-radius: 0 4px 4px 0;
}
.strategy-scope-tabs button.active {
  background: #226c78;
  border-color: #57c7c4;
  color: #efffff;
  position: relative;
}
.strategy-all-targets,
.strategy-target-state,
.strategy-empty-parameters {
  color: #8da4b9;
  font-size: 11px;
  line-height: 1.5;
  margin: 5px 0;
}
.strategy-target-search {
  border-bottom: 1px solid #273c55;
  margin-bottom: 8px;
  padding-bottom: 8px;
}
.strategy-target-list {
  min-height: 0;
  overflow: auto;
}
.strategy-target-list table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
}
.strategy-target-list th {
  color: #93aabd;
  font-size: 10px;
  font-weight: 650;
  padding: 0 5px 6px;
  text-align: left;
}
.strategy-target-list th:nth-child(2),
.strategy-target-list td:nth-child(2) {
  text-align: right;
  white-space: nowrap;
  width: 112px;
}
.strategy-target-list th:nth-child(3),
.strategy-target-list td:nth-child(3) {
  width: 28px;
}
.strategy-target-list td {
  border-top: 1px solid #233850;
  color: #c7d7e4;
  font-size: 11px;
  padding: 7px 5px;
}
.strategy-target-list td strong,
.strategy-target-list td span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strategy-target-list td strong {
  color: #e2eef6;
  font-size: 11px;
}
.strategy-target-list td span {
  color: #8199b0;
  font-size: 10px;
  margin-top: 2px;
}
.strategy-target-remove {
  align-items: center;
  background: transparent;
  border: 0;
  color: #96b0c3;
  cursor: pointer;
  display: inline-flex;
  padding: 3px;
}
.strategy-target-remove:hover {
  color: #ff9b9e;
}
.strategy-library-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
}
.strategy-parameter-panel {
  display: block;
  grid-row: 1;
}
.strategy-library-panel {
  grid-row: 2;
}
.strategy-library-actions {
  align-items: center;
  display: flex;
  gap: 7px;
}
.strategy-library-actions span {
  margin: 0;
  white-space: nowrap;
}
.strategy-library-actions button {
  background: transparent;
  border: 0;
  color: #76d8cf;
  cursor: pointer;
  font-size: 10px;
  padding: 3px;
}
.strategy-indicator-groups {
  align-content: start;
  display: grid;
  gap: 7px;
  grid-auto-rows: max-content;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}
.strategy-indicator-group {
  align-self: start;
  border: 1px solid #2a415c;
  border-radius: 5px;
  overflow: hidden;
}
.strategy-indicator-group > header {
  align-items: center;
  background: #14243a;
  display: flex;
  justify-content: space-between;
  min-height: 35px;
  padding: 0 8px 0 4px;
}
.strategy-category-toggle {
  align-items: center;
  background: transparent;
  border: 0;
  color: #c7d9e8;
  cursor: pointer;
  display: flex;
  gap: 7px;
  min-width: 0;
  padding: 6px 2px;
  text-align: left;
  width: 100%;
}
.strategy-category-toggle svg {
  color: #8eaabd;
  flex: 0 0 auto;
  transition: transform 0.16s ease;
}
.strategy-category-toggle svg.collapsed {
  transform: rotate(-90deg);
}
.strategy-category-title {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strategy-category-title strong {
  color: #c7d9e8;
  font-size: 11px;
  font-weight: 750;
}
.strategy-category-title > span {
  color: #829ab1;
  font-size: 10px;
  margin-left: 5px;
}
.strategy-category-title code {
  color: #73d8cf;
  font-family: inherit;
  font-weight: 750;
}
.strategy-indicator-items article {
  align-items: center;
  border-top: 1px solid #233950;
  display: grid;
  gap: 8px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  min-height: 45px;
  padding: 6px 8px;
}
.strategy-indicator-items article.active {
  background: #12303b;
}
.strategy-indicator-select {
  background: #18263a;
  border: 1px solid #3a526d;
  border-radius: 4px;
  color: #b8cbdb;
  cursor: pointer;
  font-size: 10px;
  min-height: 25px;
  padding: 0 7px;
}
.strategy-indicator-select.active {
  background: #1e6e70;
  border-color: #54c9bd;
  color: #efffff;
}
.strategy-indicator-items article > div {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.strategy-indicator-items article strong,
.strategy-parameter-list strong {
  color: #dfeef8;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strategy-indicator-items article code,
.strategy-parameter-list code {
  color: #73d8cf;
  font-family: ui-monospace, monospace;
  font-size: 10px;
}
.strategy-indicator-items article > div span {
  color: #90a7ba;
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.strategy-indicator-items article em {
  background: #1d3048;
  border: 1px solid #324c6a;
  border-radius: 8px;
  color: #a5bdd0;
  font-size: 9px;
  font-style: normal;
  padding: 2px 6px;
  white-space: nowrap;
}
.strategy-indicator-info {
  align-items: center;
  background: transparent;
  border: 0;
  color: #91aec2;
  cursor: pointer;
  display: inline-flex;
  justify-content: center;
  padding: 4px;
}
.strategy-indicator-info:hover,
.strategy-indicator-info[aria-expanded="true"] {
  color: #73d9d0;
}
.strategy-indicator-details {
  background: #0c1726;
  border-left: 2px solid #3d8a88;
  color: #abbecd;
  font-size: 10px;
  grid-column: 2 / -1;
  line-height: 1.4;
  margin: -1px 0 1px;
  padding: 6px 8px;
}
.strategy-indicator-details p,
.strategy-indicator-details dl,
.strategy-indicator-details dd {
  margin: 0;
}
.strategy-indicator-details dl {
  display: grid;
  gap: 5px;
  margin-top: 6px;
}
.strategy-indicator-details dl > div {
  display: grid;
  gap: 6px;
  grid-template-columns: 54px minmax(0, 1fr);
}
.strategy-indicator-details dt {
  color: #70d0c9;
  font-weight: 700;
  white-space: nowrap;
}
.strategy-indicator-details dd {
  color: #c3d1dc;
  min-width: 0;
}
.strategy-indicator-details small {
  color: #829ab1;
  display: block;
  margin-top: 6px;
}
.strategy-parameter-list {
  display: grid;
  gap: 7px;
}
.strategy-parameter-list article {
  align-items: center;
  background: #132238;
  border: 1px solid #2c455f;
  border-radius: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 8px;
}
.strategy-parameter-list article > div {
  display: grid;
  gap: 2px;
  flex: 0 1 150px;
  min-width: 120px;
}
.strategy-parameter-remove {
  align-items: center;
  background: transparent;
  border: 1px solid #3b526d;
  border-radius: 4px;
  color: #9fb5c7;
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  height: 26px;
  justify-content: center;
  margin-left: auto;
  padding: 0;
  width: 26px;
}
.strategy-parameter-remove:hover {
  background: #2a1a27;
  border-color: #d37b82;
  color: #ff9ca0;
}
.strategy-parameter-list label {
  align-items: center;
  color: #acc0d1;
  display: grid;
  font-size: 10px;
  gap: 4px;
  grid-template-columns: auto 64px;
}
.strategy-parameter-list input {
  min-height: 26px;
  padding: 0 5px;
}
.strategy-parameter-list article > small {
  color: #8399ad;
  font-size: 10px;
}
.strategy-parameter-advice {
  color: #9bb1c3;
  flex: 1 1 210px;
  font-size: 10px;
  line-height: 1.4;
  margin: 0;
  min-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes strategy-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 980px) {
  .trend-strategy-editor {
    min-height: auto;
  }
  .strategy-editor-header {
    align-items: flex-start;
    grid-template-columns: auto minmax(0, 1fr);
  }
  .strategy-editor-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
  .strategy-editor-layout {
    grid-template-columns: 1fr;
  }
  .strategy-settings-column,
  .strategy-indicator-column {
    min-height: unset;
  }
  .strategy-target-panel {
    min-height: 360px;
  }
  .strategy-library-panel {
    min-height: 460px;
  }
}
@media (max-width: 640px) {
  .strategy-editor-header {
    grid-template-columns: 1fr;
  }
  .strategy-editor-actions {
    grid-column: auto;
    justify-content: stretch;
  }
  .strategy-editor-actions button {
    flex: 1;
  }
  .strategy-data-panel {
    grid-template-columns: 1fr;
  }
  .strategy-data-panel header {
    grid-column: auto;
  }
  .strategy-indicator-items article {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .strategy-indicator-items article em {
    display: none;
  }
  .strategy-indicator-info {
    grid-column: 3;
  }
  .strategy-indicator-details {
    grid-column: 2 / -1;
  }
  .strategy-library-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
