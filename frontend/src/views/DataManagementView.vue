<script setup lang="ts">
import { Download, Upload } from "lucide-vue-next";
import { ref } from "vue";
import { api, ApiError } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const message = ref("");
async function download(): Promise<void> {
  if (token.value === null) return;
  try {
    const payload = await api.exportData(token.value);
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `ironman-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url); message.value = "数据已导出";
  } catch (error) { message.value = error instanceof ApiError ? error.message : "导出失败"; }
}
async function upload(event: Event): Promise<void> {
  if (token.value === null) return;
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  try { await api.importData(token.value, JSON.parse(await file.text())); message.value = "数据已导入"; } catch (error) { message.value = error instanceof ApiError ? error.message : "导入文件无效"; }
}
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">设置</span><h1>数据管理</h1></div></header><div class="details-grid"><section class="detail-panel"><Download :size="22" /><div><h2>导出个人数据</h2><p>导出当前账户的资产、策略、任务、告警、笔记与设置。</p><button class="secondary-button" type="button" @click="download">导出 JSON</button></div></section><section class="detail-panel"><Upload :size="22" /><div><h2>导入个人数据</h2><p>导入会替换当前账户的业务数据，不会影响其他用户。</p><label class="file-button"><Upload :size="15" />选择 JSON<input accept="application/json" type="file" @change="upload" /></label></div></section></div><p v-if="message" class="success-message data-message">{{ message }}</p></section>
</template>
