<script setup lang="ts">
import { Search } from "lucide-vue-next";
import { ref, watch } from "vue";
import { api, ApiError, type Instrument } from "@/api/client";
import { useSession } from "@/stores/session";

const emit = defineEmits<{ select: [instrument: Instrument] }>();
const { token } = useSession();
const query = ref("");
const results = ref<Instrument[]>([]);
const errorMessage = ref("");
const isSearching = ref(false);

watch(query, async (value) => {
  if (value.trim().length === 0 || token.value === null) {
    results.value = [];
    return;
  }
  isSearching.value = true;
  errorMessage.value = "";
  try {
    results.value = (await api.searchInstruments(token.value, value)).items;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "无法检索标的";
  } finally {
    isSearching.value = false;
  }
});
</script>

<template>
  <div class="instrument-search">
    <label>
      标的检索
      <div class="search-field"><Search :size="16" /><input v-model.trim="query" placeholder="代码或名称" /></div>
    </label>
    <p v-if="errorMessage" class="form-error">{{ errorMessage }}</p>
    <p v-else-if="isSearching" class="muted">正在检索。</p>
    <div v-else-if="results.length" class="search-results">
      <button v-for="instrument in results" :key="instrument.id" type="button" @click="emit('select', instrument)">
        <strong>{{ instrument.name }}</strong><span>{{ instrument.exchange.toUpperCase() }} {{ instrument.code }} · {{ instrument.assetType }}</span>
      </button>
    </div>
  </div>
</template>
