// host/chunk.ts — section-aware chunking of the extracted document text.
// Pure logic (unit-testable): splits text by headings into DocChunk[].
import type { DocChunk, DocumentText } from '../types.js';

const HEADING = /^(#{1,6}\s+.+|\d+(?:\.\d+)*\s+[A-Za-z].*)$/;

export function chunkDocument(doc: DocumentText): DocChunk[] {
  const lines = doc.fullText.split(/\r?\n/);
  const chunks: DocChunk[] = [];
  let cur: { level: number; heading: string; text: string[] } | null = null;
  let order = 0;

  const flush = () => {
    if (!cur) return;
    const body = cur.text.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (body.length > 0) {
      chunks.push({
        id: `chunk-${order++}`,
        level: cur.level,
        heading: cur.heading,
        text: body,
        sourceText: body,
      });
    }
    cur = null;
  };

  for (const line of lines) {
    const m = line.match(HEADING);
    if (m) {
      flush();
      const level = line.startsWith('#') ? line.match(/^#+/)![0].length : 2;
      cur = { level, heading: line.replace(/^#+\s*/, '').trim(), text: [] };
    } else if (cur) {
      cur.text.push(line);
    } else {
      // text before the first heading => intro chunk.
      cur = { level: 0, heading: '', text: [] };
      cur.text.push(line);
    }
  }
  flush();
  return chunks;
}
