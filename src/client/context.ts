// src/client/context.ts — minimal selection context (token-lean, for internal use only).
export interface SelectionContext {
  selection: string;
  context: string;
}

/**
 * Minimal context window around the selection: a short strip of nearby text
 * (default ±200 chars). This is ENOUGH to disambiguate the word's meaning without
 * burning tokens on the whole doc or paragraph. The context is used INTERNALLY for
 * translation — it is NOT shown to the user.
 */
export function buildSelectionContext(selection: string, docText: string, windowChars = 200): SelectionContext {
  if (!selection || !docText) return { selection, context: '' };
  const idx = docText.indexOf(selection);
  if (idx < 0) return { selection, context: '' };
  const start = Math.max(0, idx - windowChars);
  const end = Math.min(docText.length, idx + selection.length + windowChars);
  const raw = docText.slice(start, end).trim();
  return { selection, context: raw.replace(/\s+/g, ' ') };
}

/**
 * Paragraph-window variant (kept for API stability). Prefer buildSelectionContext.
 */
export function buildSelectionContextParagraphs(
  selection: string,
  docText: string,
  _paragraphs: Array<{ start: number; end: number }>,
  _windowSize = 1,
): SelectionContext {
  return buildSelectionContext(selection, docText, 200);
}
