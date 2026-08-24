// host/pdf.ts — PDF text extraction via pdfjs-dist.
// VERIFY(实现)：需要 `pdfjs-dist` 已安装；文本项结构依赖其版本。
// 双栏学术 PDF 的换行/分栏重排是最主要的质量风险，这里是启发式实现，可再增强。
import { promises as fs } from 'node:fs';
import type { DocumentText } from '../types.js';
// eslint-disable-next-line import/no-unresolved
import { getDocument } from 'pdfjs-dist';

interface TextItem { str: string; transform: number[]; width: number; height: number }

export async function extractPdf(filePath: string): Promise<DocumentText> {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await getDocument({ data }).promise;
  const items: Array<{ y: number; x: number; str: string; page: number }> = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as unknown as TextItem[]) {
      const str = (it as unknown as { str: string }).str;
      if (!str) continue;
      const [a, , , , e, f] = it.transform ?? [];
      items.push({ x: e ?? 0, y: f ?? 0, str, page: p });
    }
  }

  // Group into lines by (page, rounded y), order by x; detect a 2-column split
  // by the page's median x and stitch each column top-to-bottom.
  const fullText = reflow(items);
  const paragraphs = splitParagraphs(fullText);

  return { file: filePath, fullText, source: 'pdf', paragraphs };
}

// ---- helpers (heuristic; refine later) ----
function reflow(items: Array<{ x: number; y: number; str: string; page: number }>): string {
  const byPage = new Map<number, Array<{ x: number; y: number; str: string }>>();
  for (const it of items) {
    // normalize y to reduce float jitter
    const y = Math.round(it.y);
    byPage.set(it.page, (byPage.get(it.page) ?? []).concat([{ x: it.x, y, str: it.str }]));
  }
  let out = '';
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    const list = byPage.get(page)!;
    const xs = list.map((i) => i.x).sort((a, b) => a - b);
    const medianX = xs[Math.floor(xs.length / 2)] ?? 0;
    // two columns: left column items have x < medianX, right >= medianX
    const left = list.filter((i) => i.x < medianX);
    const right = list.filter((i) => i.x >= medianX);
    out += columnText(left) + '\n' + columnText(right) + '\n';
  }
  return out;
}

function columnText(list: Array<{ x: number; y: number; str: string }>): string {
  const lines = new Map<number, Array<{ x: number; str: string }>>();
  for (const i of list) lines.set(i.y, (lines.get(i.y) ?? []).concat([{ x: i.x, str: i.str }]));
  const ys = [...lines.keys()].sort((a, b) => a - b);
  let out = '';
  for (const y of ys) {
    const parts = lines.get(y)!.sort((a, b) => a.x - b.x).map((p) => p.str);
    out += parts.join(' ') + '\n';
  }
  return out;
}

function splitParagraphs(fullText: string): Array<{ start: number; end: number }> {
  const paragraphs: Array<{ start: number; end: number }> = [];
  const lines = fullText.split('\n');
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      paragraphs.push({ start, end: i });
      start = i + 1;
    }
  }
  paragraphs.push({ start, end: lines.length });
  return paragraphs;
}
