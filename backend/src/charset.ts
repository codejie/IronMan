/**
 * 文本解码工具：按响应声明的字符集解码字节流，兼容国内数据源常见的 GBK/GB2312 页面。
 *
 * 背景：`Response.text()` 按 WHATWG 规范恒定以 UTF-8 解码，遇到 GBK 字节流会产生
 * U+FFFD 乱码（如同花顺数据中心全站为 charset=gbk），因此所有按文本流读取的外部
 * 响应都必须经过本模块按字符集解码。
 */

const DEFAULT_ENCODING = "utf-8";
const GBK_ENCODING = "gbk";
const GB18030_ENCODING = "gb18030";
const REPLACEMENT_CHARACTER = "\uFFFD";

/** 常见中文/通用编码别名到标准编码名的映射（WHATWG 标签表的手工子集）。 */
const encodingAliases: Record<string, string> = {
  utf8: "utf-8",
  "utf-8": "utf-8",
  "unicode-1-1-utf-8": "utf-8",
  gbk: "gbk",
  gb2312: "gbk",
  "gb-2312": "gbk",
  "gb_2312": "gbk",
  "gb_2312-80": "gbk",
  csgb2312: "gbk",
  "x-gbk": "gbk",
  gb18030: "gb18030",
  big5: "big5",
  "big5-hkscs": "big5",
  "utf-16": "utf-16le",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be"
};

export function normalizeEncoding(label: string | null | undefined): string | null {
  if (label === null || label === undefined) return null;
  const cleaned = label.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (cleaned.length === 0) return null;
  const alias = encodingAliases[cleaned];
  if (alias !== undefined) return alias;
  try {
    new TextDecoder(cleaned);
    return cleaned;
  } catch {
    return null;
  }
}

export function charsetFromContentType(contentType: string | null | undefined): string | null {
  if (contentType === null || contentType === undefined) return null;
  const match = /charset\s*=\s*"?([^";,\s]+)"?/i.exec(contentType);
  return match === null ? null : normalizeEncoding(match[1]);
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function charsetFromBom(bytes: Uint8Array): { encoding: string; length: number } | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: "utf-8", length: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf-16le", length: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf-16be", length: 2 };
  }
  return null;
}

/** 从 HTML `<meta charset>` 或 XML 声明中嗅探字符集（只读取文档头部字节）。 */
export function charsetFromHtmlMeta(bytes: Uint8Array): string | null {
  const head = latin1(bytes.subarray(0, 4096));
  const metaCharset = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1];
  if (metaCharset !== undefined) {
    const encoding = normalizeEncoding(metaCharset);
    if (encoding !== null) return encoding;
  }
  const xmlEncoding = /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)["']/i.exec(head)?.[1];
  if (xmlEncoding !== undefined) {
    const encoding = normalizeEncoding(xmlEncoding);
    if (encoding !== null) return encoding;
  }
  return null;
}

function decodeWith(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return null;
  }
}

function replacementRatio(text: string): number {
  if (text.length === 0) return 0;
  let count = 0;
  for (const character of text) {
    if (character === REPLACEMENT_CHARACTER) count += 1;
  }
  return count / text.length;
}

/**
 * 解码字节流：优先 BOM，其次 HTTP 头 charset，再次文档内 meta charset，最后按 UTF-8。
 * 当响应未声明字符集且 UTF-8 解码出现大量替换字符时，尝试 GBK 兜底，避免整页乱码。
 */
export function decodeTextBytes(bytes: Uint8Array, contentType?: string | null): string {
  if (bytes.length === 0) return "";
  const bom = charsetFromBom(bytes);
  const body = bom === null ? bytes : bytes.subarray(bom.length);
  const encoding =
    bom?.encoding ??
    charsetFromContentType(contentType) ??
    charsetFromHtmlMeta(body) ??
    DEFAULT_ENCODING;
  const decoded = decodeWith(body, encoding);
  if (decoded === null) return latin1(body);
  if (encoding !== DEFAULT_ENCODING) return decoded;
  if (replacementRatio(decoded) < 0.005) return decoded;
  const gbk = decodeWith(body, GBK_ENCODING) ?? decodeWith(body, GB18030_ENCODING);
  if (gbk === null || gbk.includes(REPLACEMENT_CHARACTER)) return decoded;
  return gbk;
}
