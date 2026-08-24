// client/hooks.ts — selection context building (pure) + translation stream hook.
import * as React from 'react';
import type { TranslateEvent } from '../types.js';

export interface SelectionContext {
  selection: string;
  context: string;
}

/**
 * Build the context window for a highlighted selection.
 * context = the paragraph containing the selection ± `windowSize` neighboring
 * paragraphs (default 1). This is what satisfies "translation must use document
 * context, not just the bare selection."
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

/** Subscribe to host-driven translation events and accumulate the streamed text. */
export function useTranslationStream(): {
  state: Record<string, string>;
  start: (requestId: string) => void;
  push: (e: TranslateEvent) => void;
} {
  const [state, setState] = React.useState<Record<string, string>>({});
  const start = React.useCallback((requestId: string) => {
    setState((s) => ({ ...s, [requestId]: '' }));
  }, []);
  const push = React.useCallback((e: TranslateEvent) => {
    if (e.type === 'delta') {
      setState((s) => ({ ...s, [e.requestId]: (s[e.requestId] ?? '') + e.text }));
    } else if (e.type === 'done') {
      setState((s) => ({ ...s, [e.requestId]: e.full }));
    } else if (e.type === 'error') {
      setState((s) => ({ ...s, [e.requestId]: `[error] ${e.message}` }));
    }
  }, []);
  return { state, start, push };
}
