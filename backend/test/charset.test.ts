import { describe, expect, test } from "bun:test";
import { charsetFromContentType, decodeTextBytes, normalizeEncoding } from "../src/charset";
import { gbkBytes } from "./helpers/gbk-fixture";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("text charset decoding", () => {
  test("decodes GBK payloads announced by the HTTP content-type", () => {
    const bytes = gbkBytes("<th>序号</th><th>股票简称</th>");

    expect(decodeTextBytes(bytes, "text/html; charset=gbk")).toBe("<th>序号</th><th>股票简称</th>");
  });

  test("decodes GBK payloads announced only by the HTML meta charset", () => {
    const bytes = gbkBytes('<meta http-equiv="Content-Type" content="text/html; charset=gbk" /><title>创新高股票</title>');

    expect(decodeTextBytes(bytes, "text/html")).toContain("<title>创新高股票</title>");
  });

  test("falls back to GBK when no charset is declared at all", () => {
    const bytes = gbkBytes("<td>浦发银行</td>");

    expect(decodeTextBytes(bytes, "text/html")).toBe("<td>浦发银行</td>");
  });

  test("keeps valid UTF-8 payloads untouched", () => {
    const text = "<td>浦发银行</td>";

    expect(decodeTextBytes(utf8(text), "text/html; charset=utf-8")).toBe(text);
    expect(decodeTextBytes(utf8(text), null)).toBe(text);
  });

  test("removes the UTF-8 byte order mark", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("<td>浦发银行</td>")]);

    expect(decodeTextBytes(bytes, "text/html; charset=utf-8")).toBe("<td>浦发银行</td>");
  });

  test("returns an empty string for empty payloads", () => {
    expect(decodeTextBytes(new Uint8Array(), "text/html; charset=gbk")).toBe("");
  });

  test("maps content-type charset labels to standard encodings", () => {
    expect(charsetFromContentType("text/html; charset=GB2312")).toBe("gbk");
    expect(charsetFromContentType('text/html; charset="gb18030"')).toBe("gb18030");
    expect(charsetFromContentType("text/html; charset=utf-8")).toBe("utf-8");
    expect(charsetFromContentType("text/html")).toBeNull();
    expect(charsetFromContentType(null)).toBeNull();
    expect(normalizeEncoding("not-a-real-charset")).toBeNull();
    expect(normalizeEncoding("GBK")).toBe("gbk");
  });
});
