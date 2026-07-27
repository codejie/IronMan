<script setup lang="ts">
import { Bold, Eye, FilePlus2, Heading1, List, PencilLine, Plus, Quote, Save, Tags, Trash2, X } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { api, ApiError, type Note } from "@/api/client";
import MarkdownPreview from "@/components/MarkdownPreview.vue";
import { requestConfirmationAction } from "@/components/confirmation";
import { useSession } from "@/stores/session";
import { formatDate } from "@/utils/date-format";

type FilterMode = "title" | "tags";
type EditorMode = "edit" | "preview";

interface NoteDraft {
  id: string | null;
  content: string;
  instrumentId: string | null;
  tags: string[];
}

const { token } = useSession();
const notes = ref<Note[]>([]);
const draft = ref<NoteDraft | null>(null);
const savedSnapshot = ref("");
const selectedNoteId = ref<string | null>(null);
const searchQuery = ref("");
const filterMode = ref<FilterMode>("title");
const editorMode = ref<EditorMode>("edit");
const tagInput = ref("");
const errorMessage = ref("");
const notice = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const editor = ref<HTMLTextAreaElement>();

const filteredNotes = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  if (!query) return notes.value;
  return notes.value.filter((note) => filterMode.value === "title" ? note.title.toLocaleLowerCase().includes(query) : note.tags.some((tag) => tag.toLocaleLowerCase().includes(query)));
});
const hasUnsavedChanges = computed(() => draft.value !== null && draftSnapshot(draft.value) !== savedSnapshot.value);
const draftTitle = computed(() => draft.value === null ? "韭菜笔记" : titleFromMarkdown(draft.value.content));
const canDelete = computed(() => draft.value?.id !== null && draft.value !== null);

onMounted(() => void loadNotes());
onBeforeUnmount(() => clearTimeout(noticeTimer));
onBeforeRouteLeave(async () => resolveUnsavedChanges());

let noticeTimer: number | undefined;

async function loadNotes(preferredId?: string): Promise<void> {
  if (token.value === null) return;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    notes.value = (await api.listNotes(token.value)).items;
    const selected = notes.value.find((note) => note.id === preferredId) ?? notes.value[0] ?? null;
    applyDraft(selected);
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "笔记列表加载失败";
  } finally {
    isLoading.value = false;
  }
}

function applyDraft(note: Note | null): void {
  selectedNoteId.value = note?.id ?? null;
  draft.value = note === null ? null : { id: note.id, content: note.content, instrumentId: note.instrumentId, tags: [...note.tags] };
  savedSnapshot.value = draft.value === null ? "" : draftSnapshot(draft.value);
  tagInput.value = "";
  editorMode.value = "edit";
}

async function selectNote(note: Note): Promise<void> {
  if (note.id === selectedNoteId.value || !(await resolveUnsavedChanges())) return;
  applyDraft(note);
}

async function createNote(): Promise<void> {
  if (!(await resolveUnsavedChanges())) return;
  selectedNoteId.value = null;
  draft.value = { id: null, content: "# 新笔记\n\n", instrumentId: null, tags: [] };
  savedSnapshot.value = draftSnapshot(draft.value);
  tagInput.value = "";
  editorMode.value = "edit";
  await focusEditor();
}

async function saveNote(): Promise<boolean> {
  if (token.value === null || draft.value === null || isSaving.value) return false;
  isSaving.value = true;
  errorMessage.value = "";
  const input = { content: draft.value.content, instrumentId: draft.value.instrumentId, tags: normalizedTags(draft.value.tags), title: titleFromMarkdown(draft.value.content) };
  try {
    const saved = draft.value.id === null
      ? await api.createNote(token.value, input)
      : await api.updateNote(token.value, { id: draft.value.id, ...input });
    notes.value = [saved, ...notes.value.filter((note) => note.id !== saved.id)].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    applyDraft(saved);
    showNotice("笔记已保存");
    return true;
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "笔记保存失败，请检查后端服务是否正在运行。";
    return false;
  } finally {
    isSaving.value = false;
  }
}

async function deleteNote(): Promise<void> {
  if (draft.value === null) return;
  if (draft.value.id === null) {
    if (await resolveUnsavedChanges()) applyDraft(null);
    return;
  }
  if (!(await resolveUnsavedChanges())) return;
  const action = await requestConfirmationAction({ title: "删除笔记", message: `确认删除“${draftTitle.value}”吗？此操作无法撤销。`, confirmLabel: "删除", tone: "danger" });
  if (action !== "confirm" || token.value === null || draft.value === null) return;
  try {
    const id = draft.value.id;
    await api.deleteNote(token.value, id);
    notes.value = notes.value.filter((note) => note.id !== id);
    applyDraft(notes.value[0] ?? null);
    showNotice("笔记已删除");
  } catch (error) {
    errorMessage.value = error instanceof ApiError ? error.message : "笔记删除失败";
  }
}

async function resolveUnsavedChanges(): Promise<boolean> {
  if (!hasUnsavedChanges.value) return true;
  const action = await requestConfirmationAction({
    title: "未保存的修改",
    message: "当前笔记有未保存的修改。",
    confirmLabel: "保存后继续",
    discardLabel: "放弃修改"
  });
  if (action === "confirm") return saveNote();
  return action === "discard";
}

function addTag(): void {
  if (draft.value === null) return;
  const tag = tagInput.value.trim();
  if (!tag || draft.value.tags.includes(tag) || draft.value.tags.length >= 20) return;
  draft.value.tags.push(tag);
  tagInput.value = "";
}

function removeTag(tag: string): void {
  if (draft.value === null) return;
  draft.value.tags = draft.value.tags.filter((item) => item !== tag);
}

function insertMarkdown(prefix: string, suffix = "", placeholder = "文本"): void {
  if (draft.value === null) return;
  const element = editor.value;
  const start = element?.selectionStart ?? draft.value.content.length;
  const end = element?.selectionEnd ?? start;
  const selected = draft.value.content.slice(start, end) || placeholder;
  draft.value.content = `${draft.value.content.slice(0, start)}${prefix}${selected}${suffix}${draft.value.content.slice(end)}`;
  void nextTick(() => {
    editor.value?.focus();
    const position = start + prefix.length + selected.length + suffix.length;
    editor.value?.setSelectionRange(position, position);
  });
}

function showNotice(message: string): void {
  if (noticeTimer !== undefined) window.clearTimeout(noticeTimer);
  notice.value = message;
  noticeTimer = window.setTimeout(() => { notice.value = ""; }, 2200);
}

function draftSnapshot(value: NoteDraft): string {
  return JSON.stringify({ content: value.content, id: value.id, instrumentId: value.instrumentId, tags: normalizedTags(value.tags) });
}

function normalizedTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function titleFromMarkdown(content: string): string {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim() !== "")?.trim() ?? "";
  const title = firstLine.replace(/^#+\s*/, "").trim();
  return title || "未命名笔记";
}

async function focusEditor(): Promise<void> {
  await nextTick();
  editor.value?.focus();
}
</script>

<template>
  <section class="batman-workspace leek-notes-view">
    <header class="leek-notes-heading"><h2>韭菜笔记</h2><p v-if="notice" class="batman-notice">{{ notice }}</p></header>
    <p v-if="errorMessage" class="batman-error">{{ errorMessage }}</p>
    <div class="leek-notes-workspace">
      <aside class="leek-notes-sidebar">
        <div class="leek-notes-search"><input v-model.trim="searchQuery" data-note-search placeholder="检索笔记..." /><select v-model="filterMode" aria-label="检索范围"><option value="title">标题</option><option value="tags">标签</option></select></div>
        <button data-note-create class="batman-button primary" type="button" @click="createNote"><FilePlus2 :size="15" />新建笔记</button>
        <div v-if="isLoading" class="leek-notes-empty">加载中...</div>
        <div v-else-if="filteredNotes.length === 0" class="leek-notes-empty">没有匹配的笔记</div>
        <div v-else class="leek-notes-list">
          <button v-for="note in filteredNotes" :key="note.id" :class="{ selected: note.id === selectedNoteId }" :data-note-item="note.id" type="button" @click="selectNote(note)">
            <strong>{{ note.title }}</strong><time>{{ formatDate(note.updatedAt) }}</time>
            <span><i v-for="tag in note.tags" :key="tag">{{ tag }}</i></span>
          </button>
        </div>
      </aside>

      <main class="leek-notes-editor">
        <template v-if="draft">
          <div class="leek-notes-toolbar">
            <div class="leek-notes-mode"><button :class="{ active: editorMode === 'edit' }" type="button" @click="editorMode = 'edit'"><PencilLine :size="14" />编辑</button><button :class="{ active: editorMode === 'preview' }" type="button" @click="editorMode = 'preview'"><Eye :size="14" />预览</button></div>
            <div v-if="editorMode === 'edit'" class="leek-notes-markdown-tools"><button title="标题" type="button" @click="insertMarkdown('# ', '', '标题')"><Heading1 :size="15" /></button><button title="粗体" type="button" @click="insertMarkdown('**', '**')"><Bold :size="15" /></button><button title="列表" type="button" @click="insertMarkdown('- ', '', '列表项')"><List :size="15" /></button><button title="引用" type="button" @click="insertMarkdown('> ', '', '引用内容')"><Quote :size="15" /></button></div>
            <div class="leek-notes-spacer" />
            <button data-note-save class="batman-button primary" :disabled="!hasUnsavedChanges || isSaving" type="button" @click="saveNote"><Save :size="15" />保存</button><button class="batman-button danger" :disabled="!canDelete" type="button" @click="deleteNote"><Trash2 :size="15" />删除</button>
          </div>
          <div class="leek-notes-meta"><strong>{{ draftTitle }}</strong><span>{{ hasUnsavedChanges ? '未保存修改' : '已保存' }}</span></div>
          <div class="leek-notes-tags"><Tags :size="15" /><span v-for="tag in draft.tags" :key="tag" class="leek-note-tag">{{ tag }}<button :aria-label="`移除标签 ${tag}`" type="button" @click="removeTag(tag)"><X :size="12" /></button></span><form class="leek-notes-tag-form" @submit.prevent="addTag"><input v-model.trim="tagInput" maxlength="40" placeholder="添加标签" /><button :disabled="!tagInput.trim()" type="submit"><Plus :size="14" /></button></form></div>
          <textarea v-if="editorMode === 'edit'" ref="editor" v-model="draft.content" aria-label="笔记内容" class="leek-notes-textarea" spellcheck="false" />
          <div v-else class="leek-notes-preview"><MarkdownPreview :content="draft.content" /></div>
        </template>
        <div v-else class="leek-notes-editor-empty"><PencilLine :size="28" /><strong>选择或新建一篇笔记</strong><span>在这里记录交易观察、计划与复盘。</span><button class="batman-button primary" type="button" @click="createNote"><FilePlus2 :size="15" />新建笔记</button></div>
      </main>
    </div>
  </section>
</template>

<style scoped>
.leek-notes-view { display: flex; flex-direction: column; gap: 14px; height: calc(100dvh - 56px); max-width: none; min-height: 0; }.leek-notes-heading { align-items: end; display: flex; justify-content: space-between; }.leek-notes-heading h2 { color: #eef8ff; font-size: 21px; margin: 0; }.leek-notes-heading p { color: #91a7bd; font-size: 13px; margin: 5px 0 0; }.batman-notice { color: #78d9ce !important; margin: 0 !important; }
.leek-notes-workspace { background: #111b2b; border: 1px solid #2e445f; border-radius: 7px; display: grid; flex: 1 1 auto; grid-template-columns: minmax(245px, 30%) minmax(0, 1fr); min-height: 0; overflow: hidden; }.leek-notes-sidebar { background: #142036; border-right: 1px solid #2d435d; display: grid; gap: 12px; grid-template-rows: auto auto minmax(0, 1fr); min-height: 0; padding: 13px; }.leek-notes-search { display: grid; gap: 7px; grid-template-columns: minmax(0, 1fr) 76px; }.leek-notes-search input, .leek-notes-search select, .leek-notes-tag-form input { background: #0f1929; border: 1px solid #3b536f; border-radius: 5px; color: #e5f2fc; font-size: 13px; min-width: 0; padding: 0 9px; }.leek-notes-search input, .leek-notes-search select { height: 34px; }
.leek-notes-list { min-height: 0; overflow-y: auto; }.leek-notes-list > button { background: transparent; border: 0; border-bottom: 1px solid #293c55; color: #c1d0df; cursor: pointer; display: grid; gap: 5px; padding: 11px 9px; text-align: left; width: 100%; }.leek-notes-list > button:hover, .leek-notes-list > button.selected { background: #1a3548; }.leek-notes-list > button.selected { box-shadow: inset 3px 0 #63d3c8; }.leek-notes-list strong { color: #edf7ff; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.leek-notes-list time { color: #8fa5ba; font-size: 12px; }.leek-notes-list span { display: flex; flex-wrap: wrap; gap: 4px; }.leek-notes-list i, .leek-note-tag { background: #193344; border: 1px solid #36596b; color: #8cd8d0; font-size: 11px; font-style: normal; padding: 2px 5px; }.leek-notes-empty { color: #8fa5ba; font-size: 13px; padding: 22px 7px; text-align: center; }
.leek-notes-editor { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); min-height: 0; }.leek-notes-toolbar, .leek-notes-tags { align-items: center; border-bottom: 1px solid #2d435d; display: flex; gap: 8px; min-width: 0; padding: 9px 12px; }.leek-notes-mode, .leek-notes-markdown-tools { display: inline-flex; }.leek-notes-mode button, .leek-notes-markdown-tools button, .leek-notes-tag-form button, .leek-note-tag button { align-items: center; background: #182940; border: 1px solid #3b5571; color: #adc3d8; display: inline-flex; height: 28px; justify-content: center; padding: 0 8px; }.leek-notes-mode button + button, .leek-notes-markdown-tools button + button { border-left: 0; }.leek-notes-mode button.active { background: #277f7b; border-color: #60d5cc; color: #f4ffff; }.leek-notes-markdown-tools button { width: 31px; }.leek-notes-spacer { flex: 1; }.leek-notes-meta { align-items: center; color: #9eb2c5; display: flex; font-size: 12px; gap: 10px; padding: 10px 13px 0; }.leek-notes-meta strong { color: #eaf5fd; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.leek-notes-meta span { color: #78d5c9; flex: 0 0 auto; }.leek-notes-tags { border-bottom: 0; padding-top: 8px; }.leek-notes-tags > svg { color: #8ca9bf; flex: 0 0 auto; }.leek-note-tag { align-items: center; display: inline-flex; gap: 3px; }.leek-note-tag button { background: transparent; border: 0; color: #9ac5c4; height: 16px; padding: 0; width: 14px; }.leek-notes-tag-form { display: flex; margin-left: 3px; }.leek-notes-tag-form input { height: 25px; width: 94px; }.leek-notes-tag-form button { border-left: 0; border-radius: 0 4px 4px 0; height: 25px; padding: 0 5px; }.leek-notes-textarea, .leek-notes-preview { background: #101a2a; border: 0; border-top: 1px solid #263b53; color: #dce9f3; font: 14px/1.75 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; min-height: 0; outline: 0; overflow: auto; padding: 16px 18px; resize: none; width: 100%; }.leek-notes-preview { font-family: inherit; }.leek-notes-editor-empty { align-items: center; color: #99afc3; display: flex; flex-direction: column; gap: 11px; justify-content: center; min-height: 420px; }.leek-notes-editor-empty strong { color: #deedf8; font-size: 15px; }.leek-notes-editor-empty span { font-size: 13px; }
@media (max-width: 820px) { .leek-notes-workspace { grid-template-columns: 1fr; }.leek-notes-sidebar { border-bottom: 1px solid #2d435d; border-right: 0; max-height: 300px; }.leek-notes-editor { min-height: 540px; }.leek-notes-heading { align-items: start; flex-direction: column; gap: 8px; } }
</style>
