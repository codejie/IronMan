<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ExternalLink, PanelLeftClose, PanelLeftOpen, Search } from "lucide-vue-next";
import { api, ApiError, type ThirdPartyInfoGroup, type ThirdPartyInfoLink } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const groups = ref<ThirdPartyInfoGroup[]>([]);
const code = ref("");
const selectedUrl = ref("");
const selectedName = ref("");
const isCollapsed = ref(false);
const isLoading = ref(false);
const errorMessage = ref("");
const hasCode = computed(() => /^\d{6}$/.test(code.value.trim()));

async function load(): Promise<void> {
  if (token.value === null) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const result = await api.thirdPartyInfoLinks(token.value);
    groups.value = result.groups;
    if (selectedUrl.value === "") {
      const first = result.groups.flatMap((group) => group.links).find((link) => !link.needCode);
      if (first !== undefined) selectLink(first);
    }
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "读取资讯链接失败";
  } finally {
    isLoading.value = false;
  }
}

function resolveUrl(link: ThirdPartyInfoLink): string | null {
  if (!link.needCode) return link.url;
  if (!hasCode.value) return null;
  return link.url.replaceAll("{code}", encodeURIComponent(code.value.trim()));
}

function selectLink(link: ThirdPartyInfoLink): void {
  const url = resolveUrl(link);
  if (url === null) return;
  if (link.openInNewWindow) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  selectedName.value = link.name;
  selectedUrl.value = url;
}

function snowballUrl(): string | null {
  const normalized = code.value.trim();
  if (!/^\d{6}$/.test(normalized)) return null;
  const market = normalized.startsWith("6") ? "SH" : normalized.startsWith("8") || normalized.startsWith("4") ? "BJ" : "SZ";
  return `https://xueqiu.com/S/${market}${normalized}`;
}

function openSnowball(): void {
  const url = snowballUrl();
  if (url !== null) window.open(url, "_blank", "noopener,noreferrer");
}

function openSelectedExternally(): void {
  if (selectedUrl.value !== "") window.open(selectedUrl.value, "_blank", "noopener,noreferrer");
}

onMounted(() => void load());
</script>

<template>
  <section class="batman-workspace third-party-links" aria-label="资讯链接">
    <header class="third-party-links-heading"><h1>资讯链接</h1></header>
    <div class="third-party-links-toolbar">
      <label class="third-party-code-field"><Search :size="15" /><input v-model="code" inputmode="numeric" maxlength="6" placeholder="输入六位股票代码" /></label>
      <button class="batman-button" :disabled="!hasCode" type="button" @click="openSnowball">雪球个股<ExternalLink :size="14" /></button>
      <span v-if="!hasCode && code !== ''" class="third-party-code-hint">请输入六位股票代码后访问个股链接</span>
    </div>
    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>

    <div class="third-party-links-layout">
      <aside :class="['third-party-links-nav', { collapsed: isCollapsed }]" aria-label="资讯导航">
        <button class="third-party-collapse-button" :title="isCollapsed ? '展开链接导航' : '收起链接导航'" type="button" @click="isCollapsed = !isCollapsed"><PanelLeftOpen v-if="isCollapsed" :size="16" /><PanelLeftClose v-else :size="16" /></button>
        <template v-if="!isCollapsed">
          <section v-for="group in groups" :key="group.label" class="third-party-link-group"><h2>{{ group.label }}</h2><button v-for="link in group.links" :key="link.name" :disabled="link.needCode && !hasCode" :class="{ active: selectedName === link.name }" type="button" @click="selectLink(link)"><span>{{ link.name }}</span><ExternalLink v-if="link.openInNewWindow" :size="12" /></button></section>
        </template>
      </aside>
      <main class="third-party-link-content">
        <header><strong>{{ selectedName || "请选择资讯链接" }}</strong><button v-if="selectedUrl" class="batman-text-button" type="button" @click="openSelectedExternally">在新窗口打开 <ExternalLink :size="13" /></button></header>
        <p v-if="isLoading" class="batman-selected">正在读取导航链接...</p>
        <p v-else-if="!selectedUrl" class="third-party-link-empty">从左侧选择一个站点，或输入代码后打开个股数据。</p>
        <iframe v-else :key="selectedUrl" :src="selectedUrl" referrerpolicy="strict-origin-when-cross-origin" title="第三方财经站点" />
      </main>
    </div>
  </section>
</template>

<style scoped>
.third-party-links { max-width: none; }.third-party-links-heading { margin-bottom: 14px; }.third-party-links-heading h1 { color: #eff8ff; font-size: 22px; margin: 0; }.third-party-links-toolbar { align-items: center; border-bottom: 1px solid #263a52; display: flex; gap: 9px; margin-bottom: 14px; padding-bottom: 13px; }.third-party-code-field { align-items: center; background: #172337; border: 1px solid #374f6b; border-radius: 5px; color: #8da3ba; display: flex; gap: 7px; min-height: 32px; padding: 0 9px; width: min(300px, 34vw); }.third-party-code-field input { background: transparent; border: 0; color: #edf7ff; min-width: 0; outline: 0; width: 100%; }.third-party-code-hint { color: #8a9bb0; font-size: 12px; }.third-party-links-layout { display: grid; gap: 14px; grid-template-columns: 220px minmax(0, 1fr); min-height: calc(100dvh - 188px); }.third-party-links-nav { background: #111b2b; border: 1px solid #2b405a; border-radius: 7px; min-width: 0; overflow: auto; padding: 9px; position: relative; }.third-party-links-nav.collapsed { padding: 7px; }.third-party-collapse-button { align-items: center; background: #1b2a3f; border: 1px solid #38526f; border-radius: 4px; color: #a9bdd1; display: inline-flex; height: 27px; justify-content: center; margin: 0 0 8px auto; padding: 0; width: 27px; }.third-party-collapse-button:hover { color: #72d8cf; }.third-party-link-group + .third-party-link-group { border-top: 1px solid #26394f; margin-top: 9px; padding-top: 9px; }.third-party-link-group h2 { color: #93a9c0; font-size: 12px; margin: 0 7px 5px; }.third-party-link-group button { align-items: center; background: transparent; border: 1px solid transparent; border-radius: 4px; color: #c3d0df; display: flex; font-size: 13px; justify-content: space-between; min-height: 31px; padding: 0 7px; text-align: left; width: 100%; }.third-party-link-group button:hover, .third-party-link-group button.active { background: #1e4051; border-color: #367169; color: #cffff8; }.third-party-link-group button:disabled { color: #687b91; }.third-party-link-content { background: #111b2b; border: 1px solid #2b405a; border-radius: 7px; display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; overflow: hidden; }.third-party-link-content > header { align-items: center; border-bottom: 1px solid #2b405a; color: #e9f5ff; display: flex; font-size: 14px; justify-content: space-between; padding: 10px 12px; }.third-party-link-content iframe { border: 0; height: 100%; min-height: 720px; width: 100%; }.third-party-link-empty { align-self: center; color: #8498ae; justify-self: center; }.third-party-link-content > .batman-selected { margin: 16px; }@media (max-width: 900px) { .third-party-links-layout { grid-template-columns: 170px minmax(0, 1fr); }.third-party-links-nav.collapsed { width: 42px; }.third-party-links-layout:has(.third-party-links-nav.collapsed) { grid-template-columns: 42px minmax(0, 1fr); } }
</style>
