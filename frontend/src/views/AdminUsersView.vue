<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, ApiError, type User } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const users = ref<User[]>([]);
const errorMessage = ref("");
const isLoading = ref(true);

async function loadUsers(): Promise<void> {
  if (token.value === null) {
    return;
  }
  try {
    users.value = (await api.listUsers(token.value)).items;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "无法加载用户列表";
  } finally {
    isLoading.value = false;
  }
}

async function toggleUserStatus(user: User): Promise<void> {
  if (token.value === null) return;
  errorMessage.value = "";
  try {
    await api.updateUserStatus(token.value, user.id, user.status === "active" ? "disabled" : "active");
    await loadUsers();
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "用户状态更新失败";
  }
}

onMounted(loadUsers);
</script>

<template>
  <section class="page-section">
    <header class="page-header">
      <div>
        <span class="eyebrow">管理</span>
        <h1>用户与角色</h1>
      </div>
    </header>
    <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
    <div v-else class="data-surface">
      <p v-if="isLoading" class="muted">正在加载用户。</p>
      <table v-else>
        <thead><tr><th>显示名称</th><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>{{ user.displayName }}</td><td>{{ user.email }}</td><td>{{ user.role === "admin" ? "管理员" : "用户" }}</td>
            <td><span :class="user.status === 'active' ? 'status-tag' : 'status-tag is-muted'">{{ user.status === "active" ? "启用" : "已禁用" }}</span></td>
            <td><button class="table-button" type="button" @click="toggleUserStatus(user)">{{ user.status === "active" ? "禁用" : "启用" }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
