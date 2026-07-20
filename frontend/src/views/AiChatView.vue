<script setup lang="ts">
import { Send } from "lucide-vue-next";
import { ref } from "vue";
import { api, ApiError } from "@/api/client";
import { useSession } from "@/stores/session";

interface ChatMessage { role: "user" | "assistant"; content: string; provider?: string }
const { token } = useSession();
const input = ref(""); const messages = ref<ChatMessage[]>([]); const isSending = ref(false); const errorMessage = ref("");
async function send(): Promise<void> { if (token.value === null || input.value.trim() === "") return; const content = input.value.trim(); input.value = ""; messages.value.push({ role: "user", content }); isSending.value = true; errorMessage.value = ""; try { const result = await api.chat(token.value, content); messages.value.push({ role: "assistant", content: result.content, provider: result.provider }); } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "咨询请求失败"; } finally { isSending.value = false; } }
</script>

<template>
  <section class="page-section chat-page"><header class="page-header"><div><span class="eyebrow">智能</span><h1>AI 咨询</h1></div></header><div class="chat-surface"><div class="chat-history"><p v-if="messages.length === 0" class="muted">可以询问当前资产、持仓或行情分析。</p><article v-for="(message, index) in messages" :key="index" :class="['chat-message', message.role]"><span>{{ message.role === 'user' ? '你' : message.provider === 'openai' ? 'AI' : 'IronMan' }}</span><p>{{ message.content }}</p></article></div><form class="chat-form" @submit.prevent="send"><textarea v-model="input" placeholder="输入问题" maxlength="10000" required /><button class="primary-button send-button" :disabled="isSending" type="submit" title="发送" aria-label="发送"><Send :size="17" /></button></form></div><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p></section>
</template>
