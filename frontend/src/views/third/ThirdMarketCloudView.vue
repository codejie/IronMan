<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ExternalLink, RefreshCw } from "lucide-vue-next";
import { api, ApiError, type ThirdPartyMarketCloud } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const cloud = ref<ThirdPartyMarketCloud | null>(null);
const isLoading = ref(false);
const errorMessage = ref("");

async function load(): Promise<void> {
  if (token.value === null || isLoading.value) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    cloud.value = await api.thirdPartyMarketCloud(token.value);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "读取大盘云图失败";
  } finally {
    isLoading.value = false;
  }
}

function openExternally(): void {
  if (cloud.value !== null) window.open(cloud.value.openUrl, "_blank", "noopener,noreferrer");
}

onMounted(() => void load());
</script>

<template>
  <section class="batman-workspace third-party-market-cloud" aria-label="大盘云图">
    <header class="third-party-cloud-heading"><h1>大盘云图</h1><div class="batman-toolbar-end"><button class="batman-button" :disabled="isLoading" type="button" @click="load"><RefreshCw :class="{ spinning: isLoading }" :size="15" />刷新</button><button class="batman-button" :disabled="cloud === null" type="button" @click="openExternally">新窗口打开<ExternalLink :size="14" /></button></div></header>
    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
    <div class="third-party-cloud-frame">
      <p v-if="isLoading && cloud === null" class="batman-selected">正在加载大盘云图...</p>
      <p v-else-if="cloud === null" class="third-party-cloud-empty">暂未获取到云图地址</p>
      <iframe v-else :key="cloud.url" :src="cloud.url" referrerpolicy="strict-origin-when-cross-origin" :title="cloud.title" />
    </div>
  </section>
</template>

<style scoped>
.third-party-market-cloud { max-width: none; }.third-party-cloud-heading { align-items: center; display: flex; gap: 16px; justify-content: space-between; margin-bottom: 14px; }.third-party-cloud-heading h1 { color: #eff8ff; font-size: 22px; margin: 0; }.third-party-cloud-frame { background: #111b2b; border: 1px solid #2b405a; border-radius: 7px; height: calc(100dvh - 158px); min-height: 660px; overflow: hidden; }.third-party-cloud-frame iframe { border: 0; height: 100%; width: 100%; }.third-party-cloud-frame .batman-selected, .third-party-cloud-empty { color: #8ca1b5; margin: 24px; text-align: center; }@media (max-width: 900px) { .third-party-cloud-heading { align-items: flex-start; flex-direction: column; } }
</style>
