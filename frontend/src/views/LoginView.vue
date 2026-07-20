<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { ApiError } from "@/api/client";
import { useSession } from "@/stores/session";

const router = useRouter();
const { login, register } = useSession();
const mode = ref<"login" | "register">("login");
const displayName = ref("");
const email = ref("");
const password = ref("");
const errorMessage = ref("");
const isSubmitting = ref(false);
const submitLabel = computed(() => (mode.value === "login" ? "登录" : "创建账户"));

async function submit(): Promise<void> {
  errorMessage.value = "";
  isSubmitting.value = true;
  try {
    if (mode.value === "login") {
      await login(email.value, password.value);
    } else {
      await register(email.value, password.value, displayName.value);
    }
    await router.replace("/settings/profile");
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "暂时无法完成请求";
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-panel" aria-labelledby="auth-heading">
      <div class="auth-heading">
        <span class="eyebrow">IronMan</span>
        <h1 id="auth-heading">投资工作台</h1>
      </div>
      <div class="mode-switch" role="tablist" aria-label="账户操作">
        <button :class="{ selected: mode === 'login' }" type="button" role="tab" @click="mode = 'login'">登录</button>
        <button :class="{ selected: mode === 'register' }" type="button" role="tab" @click="mode = 'register'">注册</button>
      </div>
      <form class="auth-form" @submit.prevent="submit">
        <label v-if="mode === 'register'">
          显示名称
          <input v-model.trim="displayName" autocomplete="name" maxlength="80" required />
        </label>
        <label>
          邮箱
          <input v-model.trim="email" autocomplete="email" inputmode="email" type="email" required />
        </label>
        <label>
          密码
          <input v-model="password" autocomplete="current-password" minlength="12" type="password" required />
        </label>
        <p v-if="errorMessage" class="form-error" role="alert">{{ errorMessage }}</p>
        <button class="primary-button" :disabled="isSubmitting" type="submit">{{ isSubmitting ? "处理中" : submitLabel }}</button>
      </form>
    </section>
  </main>
</template>
