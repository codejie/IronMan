<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { api, ApiError } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const provider = ref<"local" | "openai">("local"); const baseUrl = ref(""); const model = ref(""); const apiKey = ref(""); const message = ref(""); const keyConfigured = ref(false);
onMounted(async () => { if (token.value !== null) { const config = await api.getAiConfig(token.value); provider.value = config.provider; baseUrl.value = config.baseUrl ?? ""; model.value = config.model ?? ""; keyConfigured.value = config.apiKeyConfigured; } });
watch(provider, (value) => { if (value === "local") { baseUrl.value = ""; model.value = ""; } });
async function save(): Promise<void> { if (token.value === null) return; try { const config = await api.updateAiConfig(token.value, { provider: provider.value, baseUrl: baseUrl.value || undefined, model: model.value || undefined, apiKey: apiKey.value || undefined }); keyConfigured.value = config.apiKeyConfigured; apiKey.value = ""; message.value = "AI 配置已保存"; } catch (error) { message.value = error instanceof ApiError ? error.message : "AI 配置保存失败"; } }
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">设置</span><h1>AI 配置</h1></div></header><section class="workspace-form narrow"><form class="compact-form" @submit.prevent="save"><label>提供方<select v-model="provider"><option value="local">本地工作台助手</option><option value="openai">OpenAI 兼容服务</option></select></label><template v-if="provider === 'openai'"><label>服务地址<input v-model.trim="baseUrl" placeholder="https://api.example.com/v1" required type="url" /></label><label>模型名称<input v-model.trim="model" placeholder="model-name" required /></label><label>API Key<input v-model="apiKey" :placeholder="keyConfigured ? '已配置，留空保持不变' : 'sk-...'" type="password" /></label></template><button class="primary-button" type="submit">保存配置</button></form><p v-if="message" :class="message === 'AI 配置已保存' ? 'success-message' : 'form-error'">{{ message }}</p></section></section>
</template>
