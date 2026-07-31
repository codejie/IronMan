<script setup lang="ts">
import { Search, X } from "lucide-vue-next";
import { ref, watch } from "vue";
import { api, ApiError, type Instrument } from "@/api/client";
import { useSession } from "@/stores/session";

type SelectedInstrument = Pick<Instrument, "id" | "code" | "exchange" | "name" | "assetType">;

defineProps<{ selectedInstrument?: SelectedInstrument | null }>();
const emit = defineEmits<{
  clearSelection: [];
  select: [instrument: Instrument];
}>();
const { token } = useSession();
const query = ref("");
const results = ref<Instrument[]>([]);
const errorMessage = ref("");
const isSearching = ref(false);
let searchVersion = 0;

function clear(): void {
  searchVersion += 1;
  query.value = "";
  results.value = [];
  errorMessage.value = "";
  isSearching.value = false;
}

function selectInstrument(instrument: Instrument): void {
  emit("select", instrument);
  clear();
}

function clearSelection(): void {
  emit("clearSelection");
}

watch(query, async (value) => {
  const version = ++searchVersion;
  if (value.trim().length === 0 || token.value === null) {
    results.value = [];
    errorMessage.value = "";
    isSearching.value = false;
    return;
  }
  isSearching.value = true;
  errorMessage.value = "";
  try {
    const next = await api.searchInstruments(token.value, value);
    if (version !== searchVersion) return;
    results.value = next.items;
  } catch (error) {
    if (version !== searchVersion) return;
    results.value = [];
    errorMessage.value = error instanceof ApiError ? error.message : "无法检索标的";
  } finally {
    if (version === searchVersion) isSearching.value = false;
  }
});
</script>

<template>
  <div class="instrument-search">
    <label>
      标的检索
      <div class="search-field">
        <Search :class="{ spinning: isSearching }" :size="16" />
        <span v-if="selectedInstrument" class="instrument-search-selection" data-selected-instrument>
          <span>{{ selectedInstrument.name }}</span>
          <small>{{ selectedInstrument.exchange.toUpperCase() }} {{ selectedInstrument.code }}</small>
        </span>
        <input v-model.trim="query" autocomplete="off" :placeholder="selectedInstrument ? '更换标的' : '代码或名称'" />
        <button v-if="query" aria-label="清空标的检索" class="instrument-search-clear" title="清空" type="button" @click="clear"><X :size="14" /></button>
        <button v-else-if="selectedInstrument" aria-label="清除已选标的" class="instrument-search-clear" title="清除已选标的" type="button" @click="clearSelection"><X :size="14" /></button>
      </div>
    </label>
    <div v-if="errorMessage || isSearching || results.length" class="instrument-search-popover" role="listbox">
      <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
      <p v-else-if="isSearching" class="instrument-search-status">正在检索</p>
      <div v-else class="search-results">
        <button v-for="instrument in results" :key="instrument.id" :data-instrument-search-result="instrument.id" role="option" type="button" @click="selectInstrument(instrument)">
        <strong>{{ instrument.name }}</strong><span>{{ instrument.exchange.toUpperCase() }} {{ instrument.code }} · {{ instrument.assetType }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.instrument-search { min-width: 0; position: relative; }
.search-field input { flex: 1; min-width: 92px; width: auto; }
.instrument-search-selection { align-items: center; color: #dcecff; display: inline-flex; flex: 0 1 auto; gap: 5px; max-width: min(48%, 240px); min-width: 0; overflow: hidden; white-space: nowrap; }
.instrument-search-selection span, .instrument-search-selection small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.instrument-search-selection span { min-width: 0; }
.instrument-search-selection small { color: #82dcd3; flex: 0 0 auto; font-size: 11px; }
.instrument-search-clear { align-items: center; background: transparent; border: 0; color: #8da4bb; display: inline-flex; flex: 0 0 auto; height: 24px; justify-content: center; padding: 0; width: 24px; }
.instrument-search-clear:hover { color: #dcecff; }
.instrument-search-popover { background: #151f30; border: 1px solid #3a506d; border-radius: 5px; box-shadow: 0 12px 26px rgba(0, 0, 0, 0.32); left: 0; margin-top: 5px; max-height: 210px; overflow: auto; position: absolute; right: 0; top: 100%; z-index: 30; }
.instrument-search-popover .form-error, .instrument-search-status { font-size: 12px; margin: 0; padding: 9px; }
.instrument-search-status { color: #91a6bb; }
.instrument-search-popover .search-results { border: 0; border-radius: 4px; margin: 0; max-height: none; }
.instrument-search-popover .search-results button { align-items: center; display: flex; gap: 8px; min-height: 36px; padding: 7px 9px; white-space: nowrap; }
.instrument-search-popover .search-results strong, .instrument-search-popover .search-results span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.instrument-search-popover .search-results strong { flex: 0 1 auto; }
.instrument-search-popover .search-results span { flex: 1 1 auto; min-width: 0; }
.spinning { animation: instrument-search-spin 0.8s linear infinite; }

@keyframes instrument-search-spin { to { transform: rotate(360deg); } }
</style>
