<script setup lang="ts">
import { Plus, Trash2 } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { api, ApiError, type Note } from "@/api/client";
import { useSession } from "@/stores/session";

const { token } = useSession();
const notes = ref<Note[]>([]);
const editing = ref<Note | null>(null);
const title = ref(""); const content = ref(""); const tags = ref(""); const errorMessage = ref("");
async function load(): Promise<void> { if (token.value !== null) notes.value = (await api.listNotes(token.value)).items; }
onMounted(load);
function edit(note?: Note): void { editing.value = note ?? null; title.value = note?.title ?? ""; content.value = note?.content ?? ""; tags.value = note?.tags.join(", ") ?? ""; }
async function save(): Promise<void> { if (token.value === null) return; const input = { title: title.value, content: content.value, tags: tags.value.split(",").map((tag) => tag.trim()).filter(Boolean), instrumentId: null }; try { if (editing.value === null) await api.createNote(token.value, input); else await api.updateNote(token.value, { id: editing.value.id, ...input }); edit(); await load(); } catch (error) { errorMessage.value = error instanceof ApiError ? error.message : "笔记保存失败"; } }
async function remove(id: string): Promise<void> { if (token.value === null) return; await api.deleteNote(token.value, id); await load(); }
</script>

<template>
  <section class="page-section"><header class="page-header"><div><span class="eyebrow">笔记</span><h1>投资笔记</h1></div><button class="table-button" type="button" @click="edit()"><Plus :size="16" /> 新建</button></header><div class="workspace-grid"><section class="workspace-form"><form class="compact-form" @submit.prevent="save"><label>标题<input v-model.trim="title" maxlength="200" required /></label><label>标签<input v-model="tags" placeholder="复盘, ETF" /></label><label>内容<textarea v-model="content" maxlength="100000" required /></label><button class="primary-button" type="submit">{{ editing === null ? "保存笔记" : "更新笔记" }}</button></form><p v-if="errorMessage" class="form-error">{{ errorMessage }}</p></section><section class="note-list"><article v-for="note in notes" :key="note.id" class="note-item"><header><div><h2>{{ note.title }}</h2><span>{{ note.tags.join(" · ") || "未分类" }}</span></div><div class="note-actions"><button class="table-button" type="button" @click="edit(note)">编辑</button><button class="icon-button light" :aria-label="`删除 ${note.title}`" title="删除笔记" type="button" @click="remove(note.id)"><Trash2 :size="16" /></button></div></header><p>{{ note.content }}</p><footer>{{ new Date(note.updatedAt).toLocaleString() }}</footer></article><p v-if="notes.length === 0" class="muted">尚无投资笔记。</p></section></div></section>
</template>
