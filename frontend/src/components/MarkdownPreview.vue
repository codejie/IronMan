<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{ content: string; compact?: boolean }>(), { compact: false });

type MarkdownBlock =
  | { kind: "heading"; level: number; html: string }
  | { kind: "paragraph"; html: string }
  | { kind: "quote"; html: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "code"; content: string };

const blocks = computed(() => parseMarkdown(props.content));

function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const output: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      output.push({ kind: "code", content: codeLines.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      output.push({ kind: "heading", level: heading[1]?.length ?? 1, html: inlineHtml(heading[2] ?? "") });
      index += 1;
      continue;
    }
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      output.push({ kind: "quote", html: inlineHtml(quoteLines.join("\n")) });
      continue;
    }
    const headers = tableCells(line);
    if (headers !== null && isTableDivider(lines[index + 1] ?? "")) {
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const cells = tableCells(lines[index] ?? "");
        if (cells === null) break;
        rows.push(headers.map((_, cellIndex) => inlineHtml(cells[cellIndex] ?? "")));
        index += 1;
      }
      output.push({ kind: "table", headers: headers.map(inlineHtml), rows });
      continue;
    }
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const pattern = unordered ? /^[-*+]\s+(.+)$/ : /^\d+\.\s+(.+)$/;
      while (index < lines.length) {
        const match = (lines[index] ?? "").match(pattern);
        if (!match) break;
        items.push(inlineHtml(match[1] ?? ""));
        index += 1;
      }
      output.push({ kind: "list", ordered: Boolean(ordered), items });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && isParagraphLine(lines[index] ?? "")) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    output.push({ kind: "paragraph", html: inlineHtml(paragraph.join("\n")) });
  }
  return output;
}

function isParagraphLine(line: string): boolean {
  return line.trim() !== "" && !line.startsWith("```") && !/^#{1,6}\s+/.test(line) && !line.startsWith(">") && !/^[-*+]\s+/.test(line) && !/^\d+\.\s+/.test(line);
}

function tableCells(line: string): string[] | null {
  if (!line.includes("|")) return null;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = trimmed.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function isTableDivider(line: string): boolean {
  const cells = tableCells(line);
  return cells !== null && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function inlineHtml(source: string): string {
  return escapeHtml(source)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer" target="_blank">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, (_match, prefix: string, text: string) => `${prefix}<em>${text}</em>`)
    .replace(/\n/g, "<br>");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
</script>

<template>
  <article :class="['markdown-preview', { compact: props.compact }]">
    <template v-for="(block, index) in blocks" :key="index">
      <component :is="`h${block.level}`" v-if="block.kind === 'heading'" v-html="block.html" />
      <p v-else-if="block.kind === 'paragraph'" v-html="block.html" />
      <blockquote v-else-if="block.kind === 'quote'" v-html="block.html" />
      <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.kind === 'list'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex" v-html="item" />
      </component>
      <div v-else-if="block.kind === 'table'" class="markdown-table-wrap">
        <table>
          <thead><tr><th v-for="(header, headerIndex) in block.headers" :key="headerIndex" v-html="header" /></tr></thead>
          <tbody><tr v-for="(row, rowIndex) in block.rows" :key="rowIndex"><td v-for="(cell, cellIndex) in row" :key="cellIndex" v-html="cell" /></tr></tbody>
        </table>
      </div>
      <pre v-else><code>{{ block.content }}</code></pre>
    </template>
  </article>
</template>

<style scoped>
.markdown-preview { color: #d6e3ef; font-size: 14px; line-height: 1.8; min-height: 100%; overflow-wrap: anywhere; padding: 4px 4px 24px; }
.markdown-preview.compact { font-size: inherit; line-height: inherit; min-height: 0; padding: 0; }
.markdown-preview.compact :deep(h1), .markdown-preview.compact :deep(h2), .markdown-preview.compact :deep(h3) { margin: 0.8em 0 0.35em; }.markdown-preview.compact :deep(h1) { font-size: 19px; }.markdown-preview.compact :deep(h2) { font-size: 17px; }.markdown-preview.compact :deep(h3) { font-size: 15px; }
.markdown-preview :deep(h1), .markdown-preview :deep(h2), .markdown-preview :deep(h3), .markdown-preview :deep(h4), .markdown-preview :deep(h5), .markdown-preview :deep(h6) { color: #f0f8ff; line-height: 1.35; margin: 1.25em 0 0.5em; }
.markdown-preview :deep(h1) { font-size: 25px; }.markdown-preview :deep(h2) { font-size: 21px; }.markdown-preview :deep(h3) { font-size: 18px; }
.markdown-preview :deep(p) { margin: 0 0 0.95em; }.markdown-preview :deep(ul), .markdown-preview :deep(ol) { margin: 0 0 0.95em; padding-left: 1.5em; }
.markdown-preview :deep(blockquote) { border-left: 3px solid #4ebbb2; color: #aac1d2; margin: 0 0 0.95em; padding-left: 12px; }
.markdown-preview :deep(pre) { background: #0d1624; border: 1px solid #2b4059; overflow-x: auto; padding: 12px; }.markdown-preview :deep(code) { color: #8bddd4; }
.markdown-preview :deep(a) { color: #70dcd2; }.markdown-preview :deep(strong) { color: #eff8ff; }
.markdown-preview :deep(.markdown-table-wrap) { margin: 0 0 0.95em; overflow-x: auto; }.markdown-preview :deep(table) { border-collapse: collapse; min-width: 100%; }.markdown-preview :deep(th), .markdown-preview :deep(td) { border: 1px solid #304861; padding: 5px 8px; text-align: left; white-space: nowrap; }.markdown-preview :deep(th) { background: #1a2d44; color: #ecf7ff; font-weight: 700; }.markdown-preview :deep(td) { color: #c3d5e4; }
</style>
