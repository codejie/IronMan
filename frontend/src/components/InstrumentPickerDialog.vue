<script setup lang="ts">
import { Search, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { api, ApiError, type AssetType, type Instrument } from "@/api/client";
import { useSession } from "@/stores/session";
import { instrumentCodeLabel } from "@/views/instrument-kline-presentation";

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  initialAssetType?: AssetType;
  confirmLabel?: string;
  errorMessage?: string;
  busy?: boolean;
}>(), {
  busy: false,
  confirmLabel: "确定",
  errorMessage: "",
  initialAssetType: "stock"
});

const emit = defineEmits<{
  close: [];
  confirm: [instrument: Instrument];
}>();

const { token } = useSession();
const assetType = ref<AssetType>(props.initialAssetType);
const query = ref("");
const results = ref<Instrument[]>([]);
const selectedInstrument = ref<Instrument | null>(null);
const errorMessage = ref("");
const isSearching = ref(false);
let searchTimer: number | undefined;
let searchVersion = 0;

const filteredResults = computed(() => results.value.filter((instrument) => instrument.assetType === assetType.value));
const displayedErrorMessage = computed(() => props.errorMessage || errorMessage.value);

function reset(): void {
  clearSearchTimer();
  searchVersion += 1;
  assetType.value = props.initialAssetType;
  query.value = "";
  results.value = [];
  selectedInstrument.value = null;
  errorMessage.value = "";
  isSearching.value = false;
}

function close(): void {
  emit("close");
}

function selectInstrument(instrument: Instrument): void {
  selectedInstrument.value = instrument;
}

function confirm(): void {
  if (selectedInstrument.value === null || props.busy) return;
  emit("confirm", selectedInstrument.value);
}

function clearSearchTimer(): void {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = undefined;
}

function scheduleSearch(): void {
  clearSearchTimer();
  selectedInstrument.value = null;
  errorMessage.value = "";
  const value = query.value.trim();
  const version = ++searchVersion;
  if (token.value === null || value.length === 0) {
    results.value = [];
    isSearching.value = false;
    return;
  }
  searchTimer = window.setTimeout(() => {
    void search(value, version);
  }, 240);
}

async function search(value: string, version: number): Promise<void> {
  if (token.value === null) return;

  isSearching.value = true;
  try {
    const items = (await api.searchInstruments(token.value, value, assetType.value)).items;
    if (version !== searchVersion) return;
    results.value = items;
  } catch (error) {
    if (version !== searchVersion) return;
    results.value = [];
    errorMessage.value = error instanceof ApiError ? error.message : "无法检索标的";
  } finally {
    if (version === searchVersion) isSearching.value = false;
  }
}

watch(() => props.open, (open) => {
  if (open) reset();
});

watch(assetType, () => {
  scheduleSearch();
});

watch(query, () => {
  scheduleSearch();
});

onBeforeUnmount(clearSearchTimer);
</script>

<template>
  <div v-if="open" class="batman-dialog-backdrop" @click.self="close">
    <section aria-modal="true" class="batman-dialog instrument-picker-dialog" role="dialog">
      <header>
        <strong>{{ title }}</strong>
        <button aria-label="关闭对话框" class="batman-icon-button" title="关闭" type="button" @click="close"><X :size="18" /></button>
      </header>

      <div class="instrument-picker-form">
        <label>
          <span>类型</span>
          <select v-model="assetType">
            <option value="stock">股票</option>
            <option value="index">指数</option>
            <option value="fund">基金</option>
          </select>
        </label>

        <label>
          <span>名称/代码</span>
          <div class="instrument-picker-search-field">
            <Search :class="{ spinning: isSearching }" :size="16" />
            <input v-model.trim="query" autocomplete="off" placeholder="输入代码或名称" />
          </div>
        </label>

        <p v-if="displayedErrorMessage" class="batman-error">{{ displayedErrorMessage }}</p>
        <p v-else-if="results.length > 0 && filteredResults.length === 0" class="instrument-picker-empty">没有匹配当前类型的标的</p>

        <div v-if="filteredResults.length > 0" class="instrument-picker-results" role="listbox">
          <button
            v-for="instrument in filteredResults"
            :key="instrument.id"
            :aria-selected="selectedInstrument?.id === instrument.id"
            :class="{ selected: selectedInstrument?.id === instrument.id }"
            :data-instrument-picker-result="instrument.id"
            role="option"
            type="button"
            @click="selectInstrument(instrument)"
          >
            <strong>{{ instrument.name }}</strong>
            <span>{{ instrumentCodeLabel(instrument) }}</span>
          </button>
        </div>

        <p v-if="selectedInstrument" class="instrument-picker-selection">已选择：{{ selectedInstrument.name }} {{ instrumentCodeLabel(selectedInstrument) }}</p>

        <footer>
          <button class="batman-button" type="button" @click="close">取消</button>
          <button data-instrument-picker-confirm class="batman-button primary" :disabled="selectedInstrument === null || busy" type="button" @click="confirm">{{ confirmLabel }}</button>
        </footer>
      </div>
    </section>
  </div>
</template>

<style scoped>
.instrument-picker-dialog { font-size: 14px; max-width: 520px; width: min(100%, 520px); }
.instrument-picker-dialog > header { font-size: 14px; }
.instrument-picker-form { display: grid; gap: 14px; }
.instrument-picker-form > label { align-items: center; display: grid; gap: 12px; grid-template-columns: 92px minmax(0, 1fr); }
.instrument-picker-form > label > span { color: #aec0d2; font-size: 14px; font-weight: 650; text-align: right; }
.instrument-picker-form select, .instrument-picker-form input { background: #1d293b; border: 1px solid #3a506d; border-radius: 5px; color: #eaf3fb; font-size: 14px; min-height: 38px; padding: 0 10px; }
.instrument-picker-form select:focus, .instrument-picker-form input:focus { border-color: #65d7ca; outline: 1px solid #65d7ca; }
.instrument-picker-search-field { align-items: center; background: #1d293b; border: 1px solid #3a506d; border-radius: 5px; display: flex; gap: 8px; min-height: 38px; padding-left: 10px; }
.instrument-picker-search-field:focus-within { border-color: #65d7ca; outline: 1px solid #65d7ca; }
.instrument-picker-search-field > svg { color: #8da4bb; flex: 0 0 auto; }
.instrument-picker-search-field input { background: transparent; border: 0; border-radius: 0; flex: 1; min-width: 0; outline: 0; padding-left: 0; }
.instrument-picker-search-field input:focus { border: 0; outline: 0; }
.instrument-picker-results { background: #111b2b; border: 1px solid #30445e; border-radius: 6px; display: grid; max-height: 224px; overflow-y: auto; }
.instrument-picker-results button { background: transparent; border: 0; border-bottom: 1px solid #273950; color: #d7e5ef; display: grid; font-size: 14px; gap: 3px; min-height: 56px; padding: 9px 12px; text-align: left; }
.instrument-picker-results button:last-child { border-bottom: 0; }
.instrument-picker-results button:hover, .instrument-picker-results button.selected { background: #1a3447; }
.instrument-picker-results button.selected { box-shadow: inset 3px 0 #65d7ca; }
.instrument-picker-results strong { color: #eef8ff; font-size: 14px; font-weight: 700; }
.instrument-picker-results span { color: #91a6bb; font-size: 14px; }
.instrument-picker-empty, .instrument-picker-selection { color: #9eb3c8; font-size: 14px; margin: 0; }
.instrument-picker-dialog .batman-error { font-size: 14px; }
.instrument-picker-selection { color: #83d1c8; }
.instrument-picker-form footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.instrument-picker-form footer .batman-button { font-size: 14px; }
.spinning { animation: instrument-picker-spin 0.8s linear infinite; }

@keyframes instrument-picker-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .instrument-picker-form > label { gap: 6px; grid-template-columns: 1fr; }
  .instrument-picker-form > label > span { text-align: left; }
}
</style>
