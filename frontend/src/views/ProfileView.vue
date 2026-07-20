<script setup lang="ts">
import { KeyRound, ShieldCheck } from "lucide-vue-next";
import { ref } from "vue";
import { api, ApiError } from "@/api/client";
import { useSession } from "@/stores/session";

const { currentUser, replaceUser, token } = useSession();
const displayName = ref(currentUser.value?.displayName ?? "");
const currentPassword = ref("");
const newPassword = ref("");
const profileMessage = ref("");
const passwordMessage = ref("");
const isSavingProfile = ref(false);
const isSavingPassword = ref(false);

async function saveProfile(): Promise<void> {
  if (token.value === null) return;
  profileMessage.value = "";
  isSavingProfile.value = true;
  try {
    replaceUser(await api.updateProfile(token.value, displayName.value));
    profileMessage.value = "资料已更新";
  } catch (error) {
    profileMessage.value = error instanceof ApiError ? error.message : "资料更新失败";
  } finally {
    isSavingProfile.value = false;
  }
}

async function savePassword(): Promise<void> {
  if (token.value === null) return;
  passwordMessage.value = "";
  isSavingPassword.value = true;
  try {
    await api.changePassword(token.value, currentPassword.value, newPassword.value);
    currentPassword.value = "";
    newPassword.value = "";
    passwordMessage.value = "密码已更新";
  } catch (error) {
    passwordMessage.value = error instanceof ApiError ? error.message : "密码更新失败";
  } finally {
    isSavingPassword.value = false;
  }
}
</script>

<template>
  <section class="page-section">
    <header class="page-header">
      <div>
        <span class="eyebrow">账户</span>
        <h1>个人与安全</h1>
      </div>
    </header>
    <div class="details-grid">
      <section class="detail-panel">
        <ShieldCheck :size="22" aria-hidden="true" />
        <div class="account-overview">
          <h2>{{ currentUser?.displayName }}</h2>
          <p>{{ currentUser?.email }}</p>
          <span class="status-tag">{{ currentUser?.role === "admin" ? "管理员" : "普通用户" }}</span>
          <form class="inline-form" @submit.prevent="saveProfile">
            <label>显示名称<input v-model.trim="displayName" maxlength="80" required /></label>
            <button class="secondary-button" :disabled="isSavingProfile" type="submit">{{ isSavingProfile ? "保存中" : "保存资料" }}</button>
            <p v-if="profileMessage" :class="profileMessage === '资料已更新' ? 'success-message' : 'form-error'">{{ profileMessage }}</p>
          </form>
        </div>
      </section>
      <section class="detail-panel">
        <KeyRound :size="22" aria-hidden="true" />
        <div class="account-overview">
          <h2>会话安全</h2>
          <form class="inline-form" @submit.prevent="savePassword">
            <label>当前密码<input v-model="currentPassword" autocomplete="current-password" minlength="12" required type="password" /></label>
            <label>新密码<input v-model="newPassword" autocomplete="new-password" minlength="12" required type="password" /></label>
            <button class="secondary-button" :disabled="isSavingPassword" type="submit">{{ isSavingPassword ? "保存中" : "更新密码" }}</button>
            <p v-if="passwordMessage" :class="passwordMessage === '密码已更新' ? 'success-message' : 'form-error'">{{ passwordMessage }}</p>
          </form>
        </div>
      </section>
    </div>
  </section>
</template>
