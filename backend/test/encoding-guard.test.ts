import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".vue",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".html",
  ".css",
  ".py",
  ".sh",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".sql"
]);

function trackedTextFiles(): string[] {
  const result = Bun.spawnSync({ cmd: ["git", "ls-files", "-z"], cwd: repositoryRoot });
  if (!result.success) return [];
  return new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter((file) => file.length > 0 && textExtensions.has(file.slice(file.lastIndexOf(".")).toLowerCase()));
}

describe("repository encoding guard", () => {
  test("keeps every tracked text file UTF-8 without BOM and with LF line endings", () => {
    const files = trackedTextFiles();
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const bytes = readFileSync(join(repositoryRoot, file));
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) violations.push(`${file}: 存在 UTF-8 BOM`);
      if (bytes.includes(0x0d)) violations.push(`${file}: 存在 CRLF 换行`);
      let text = "";
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        violations.push(`${file}: 不是合法 UTF-8`);
        continue;
      }
      if (text.includes("\uFFFD")) violations.push(`${file}: 包含 U+FFFD 乱码字符`);
    }

    expect(violations).toEqual([]);
  });

  test("declares LF normalization so line endings stay stable across platforms", () => {
    const attributes = readFileSync(join(repositoryRoot, ".gitattributes"), "utf8");

    expect(attributes).toContain("text=auto");
    expect(attributes).toContain("eol=lf");
  });
});
