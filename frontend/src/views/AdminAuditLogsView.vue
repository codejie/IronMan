<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError, type AuditLog } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const items = ref<AuditLog[]>([]);
const errorMessage = ref("");
const isLoading = ref(true);

onMounted(async () => {
  if (token.value === null) return;
  try {
    items.value = (await api.listAuditLogs(token.value)).items;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "无法加载审计日志";
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <section class="page-section">
    <header class="page-header"><div><span class="eyebrow">管理</span><h1>审计日志</h1></div></header>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
    <div v-else class="data-surface">
      <p v-if="isLoading" class="muted">正在加载记录。</p>
      <table v-else>
        <thead><tr><th>时间</th><th>操作者</th><th>事件</th></tr></thead>
        <tbody><tr v-for="item in items" :key="item.id"><td>{{ new Date(item.createdAt).toLocaleString() }}</td><td>{{ item.actorDisplayName ?? item.actorEmail ?? "系统" }}</td><td>{{ item.action }}</td></tr></tbody>
      </table>
    </div>
  </section>
</template>
