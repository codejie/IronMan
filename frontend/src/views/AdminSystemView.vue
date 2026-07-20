<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError, type SystemStatus } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const status = ref<SystemStatus | null>(null);
const errorMessage = ref("");

onMounted(async () => {
  if (token.value === null) return;
  try {
    status.value = await api.systemStatus(token.value);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "无法读取系统状态";
  }
});
</script>

<template>
  <section class="page-section">
    <header class="page-header"><div><span class="eyebrow">管理</span><h1>系统状态</h1></div></header>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
    <div v-else-if="status" class="details-grid">
      <section class="detail-panel"><div><h2>数据库</h2><p>{{ status.database.toUpperCase() }}</p><span class="status-tag">迁移 {{ status.migrationVersions.join(", ") }}</span></div></section>
      <section class="detail-panel"><div><h2>任务模式</h2><p>{{ status.schedulerMode }}</p><span class="status-tag">{{ new Date(status.time).toLocaleString() }}</span></div></section>
    </div>
    <div v-else class="data-surface muted">正在读取系统状态。</div>
  </section>
</template>
