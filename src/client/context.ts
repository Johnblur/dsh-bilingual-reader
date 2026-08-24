// src/client/context.ts — pure selection-context builder (no React dependency).
export interface SelectionContext {
  selection: string;
  context: string;
}

/**
 * Build the context window for a highlighted selection: the paragraph containing
 * the selection ± `windowSize` neighboring paragraphs (default 1). This satisfies
 * "translation must use document context, not just the bare selection."
 */
export function buildSelectionContext(
  selection: string,
  docText: string,
  paragraphs: Array<{ start: number; end: number }>,
  windowSize = 1,
): SelectionContext {
  if (!selection || !docText) return { selection, context: '' };
  const idx = docText.indexOf(selection);
  const lines = docText.split(/\r?\n/);
  const startLine = idx >= 0 ? directionCount(docText, idx, '\n') : 0;
  let pIdx = paragraphs.findIndex((p) => startLine >= p.start && startLine < p.end);
  if (pIdx < 0) pIdx = paragraphs.length ? 0 : -1;
  if (pIdx < 0) return { selection, context: selection };

  const lo = Math.max(0, pIdx - windowSize);
  const hi = Math.min(paragraphs.length - 1, pIdx + windowSize);
  const parts: string[] = [];
  for (let i = lo; i <= hi; i++) {
    const p = paragraphs[i];
    parts.push(lines.slice(p.start, p.end).join('\n'));
  }
  return { selection, context: parts.join('\n\n') };
}

function directionCount(s: string, upto: number, char: string): number {
  let n = 0;
  for (let i = 0; i < upto; i++) if (s[i] === char) n++;
  return n;
}
