// src/client/match.ts — tolerant fuzzy matching between a copied PDF selection
// and the extracted document text.
//
// Why: pdfjs extraction splits words across lines / hyphens ("multi-\nhead",
// "multi- head") and yields whitespace, case, and stray-character differences,
// so an exact `indexOf` of a copied paragraph against fullText almost never
// matches. We instead normalize, tokenize, and slide a window over the doc's
// token stream, scoring overlap with the selection's tokens. This recovers the
// right position for most real selections while still rejecting clear misses.

/** Merge hyphen/line-break splits and collapse whitespace, lowercased. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[-\u2010\u2011]\s*\n\s*/g, '')   // "multi-\nhead" -> "multihead"
    .replace(/[-\u2010\u2011]\s+/g, '')        // "multi- head" -> "multihead"
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

const TOKEN_RE = /[A-Za-z0-9]+|[\u3041-\u30ff\u3400-\u9fff\uac00-\ud7af\u3000-\u303f]/g;

/** Tokenize a normalized string into word-ish tokens (Latin words; CJK per char). */
function tokenize(normalized: string): string[] {
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(normalized)) !== null) tokens.push(m[0]);
  return tokens;
}

/** Overlap score of a window token set against the selection tokens (multiset). */
function overlapScore(windowTokens: string[], selTokens: string[]): number {
  if (selTokens.length === 0) return 0;
  const selSet = new Map<string, number>();
  for (const t of selTokens) selSet.set(t, (selSet.get(t) ?? 0) + 1);
  const used = new Map<string, number>();
  let hit = 0;
  for (const t of windowTokens) {
    const have = used.get(t) ?? 0;
    if (have < (selSet.get(t) ?? 0)) { used.set(t, have + 1); hit++; }
  }
  return hit / selTokens.length;
}

export interface MatchResult {
  /** Character offset of the best window's start within the normalized doc. */
  start: number;
  /** Overlap score of the best window (0..1). */
  score: number;
  /** Number of distinct windows that cleared the threshold. */
  count: number;
}

/**
 * Find the best window in `doc` whose token overlap with `sel` is highest.
 * Returns offsets in the NORMALIZED doc (so callers slice normalized text).
 * `null` when no window reaches `threshold`.
 */
export function fuzzyMatch(doc: string, sel: string, threshold = 0.6): MatchResult | null {
  const normDoc = normalizeForMatch(doc);
  const normSel = normalizeForMatch(sel);
  const selTokens = tokenize(normSel);
  if (selTokens.length === 0) return null;
  const docTokens = tokenize(normDoc);
  if (docTokens.length === 0) return null;
  const selCount = selTokens.length;

  // Precompute each doc token's start offset in normDoc.
  const starts: number[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(normDoc)) !== null) starts.push(m.index);

  let best: { start: number; score: number } | null = null;
  let clear = 0;

  // Slide exact-length windows.
  for (let i = 0; i + selCount <= docTokens.length; i++) {
    const win = docTokens.slice(i, i + selCount);
    const score = overlapScore(win, selTokens);
    if (best === null || score > best.score) best = { start: starts[i], score };
    if (score >= threshold) clear++;
  }
  // Edge slack: windows of selCount±1 in case a boundary token is dropped.
  if ((best === null || best.score < threshold) && selCount > 1) {
    for (let d = -1; d <= 1; d++) {
      const w = selCount + d;
      if (w <= 0) continue;
      for (let i = 0; i + w <= docTokens.length; i++) {
        const win = docTokens.slice(i, i + w);
        const score = overlapScore(win, selTokens);
        if (best === null || score > best.score) best = { start: starts[i], score };
        if (score >= threshold) clear++;
      }
    }
  }

  if (best === null || best.score < threshold) return null;
  return { start: best.start, score: best.score, count: Math.max(1, clear) };
}

/** Compute the context slice around a matched start (in the normalized doc). */
export function contextRange(start: number, sel: string, contextLen: number): { from: number; to: number } {
  const selLen = normalizeForMatch(sel).length;
  const from = Math.max(0, start - contextLen);
  const to = start + selLen + contextLen;
  return { from, to };
}
