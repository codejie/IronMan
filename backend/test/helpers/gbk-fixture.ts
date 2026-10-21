const gbkCodePoints: Record<string, string> = {
  序: "d0f2",
  号: "bac5",
  股: "b9c9",
  票: "c6b1",
  代: "b4fa",
  码: "c2eb",
  简: "bcf2",
  称: "b3c6",
  连: "c1ac",
  涨: "d5c7",
  天: "ccec",
  数: "cafd",
  放: "b7c5",
  量: "c1bf",
  价: "bcdb",
  齐: "c6eb",
  升: "c9fd",
  浦: "c6d6",
  发: "b7a2",
  银: "d2f8",
  行: "d0d0",
  创: "b4b4",
  新: "d0c2",
  高: "b8df",
  历: "c0fa",
  史: "cab7",
  半: "b0eb",
  年: "c4ea",
  一: "d2bb",
  月: "d4c2",
  日: "c8d5",
  全: "c8ab",
  部: "b2bf",
  跌: "b5f8",
  格: "b8f1",
  成: "b3c9",
  交: "bdbb",
  额: "b6ee",
  换: "bbbb",
  手: "cad6",
  率: "c2ca",
  封: "b7e2",
  板: "b0e5",
  资: "d7ca",
  金: "bdf0",
  流: "c1f7",
  通: "cda8",
  市: "cad0",
  值: "d6b5",
  总: "d7dc",
  名: "c3fb",
  最: "d7ee",
  幅: "b7f9",
  平: "c6bd",
  安: "b0b2",
  第: "b5da",
  三: "c8fd",
  季: "bcbe",
  度: "b6c8",
  报: "b1a8",
  告: "b8e6",
  公: "b9ab",
  巨: "bede",
  潮: "b3b1",
  讯: "d1b6",
  标: "b1ea",
  题: "cce2",
  闻: "cec5",
  内: "c4da",
  容: "c8dd",
  页: "d2b3",
  面: "c3e6",
  测: "b2e2",
  试: "cad4",
  据: "bedd",
  解: "bde2",
  字: "d7d6",
  符: "b7fb",
  集: "bcaf"
};

export function gbkBytes(text: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
      continue;
    }
    const codePointHex = gbkCodePoints[character];
    if (codePointHex === undefined) throw new Error(`GBK 夹具缺少字符：${character}`);
    bytes.push(Number.parseInt(codePointHex.slice(0, 2), 16), Number.parseInt(codePointHex.slice(2, 4), 16));
  }
  const buffer = new ArrayBuffer(bytes.length);
  const view = new Uint8Array(buffer);
  view.set(bytes);
  return view;
}

export function gbkHtml(markup: string): Uint8Array<ArrayBuffer> {
  return gbkBytes(markup);
}

export const thsRankingMarkup = `<table><thead><tr><th width="60" class="first" rowspan="2">序号</th><th width="140">股票代码</th><th width="120">股票简称</th><th width="100">连涨天数</th></tr></thead><tbody><tr><td>1</td><td><a href="/stock/detail/code/600000/">600000</a></td><td>浦发银行</td><td>4</td></tr><tr><td>2</td><td><a href="/stock/detail/code/000001/">000001</a></td><td>平安银行</td><td>5</td></tr></tbody></table>`;

export const thsCharsetMetaMarkup = `<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=gbk" /><title>创新高股票</title></head><body>${thsRankingMarkup}</body></html>`;
