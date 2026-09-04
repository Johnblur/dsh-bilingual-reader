// src/client/match.ts — match a copied PDF selection against the extracted text
// by their LETTER SEQUENCES only (ignore punctuation / whitespace / hyphens /
// case). Rationale: pdfjs extraction inserts hyphens & line breaks ("multi-\n
// head") and varies spacing/punctuation, but the underlying letters are stable.
// Comparing only lowercased letters makes "Transformer-based model",
// "Transformer based model", and "Transformer-based model," collapse to the
// same contiguous letter run - so an exact substring search on letter sequences
// recovers the true position and, unlike a bag-of-words overlap, does NOT
// over-report a long sentence (a long letter run appears once, not at every
// sliding window).

/** Merge hyphen/line-break splits and collapse whitespace, lowercased (for the
 *  display copy of the selection / "原文"). */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[-\u2010\u2011]\s*\n\s*/g, '')
    .replace(/[-\u2010\u2011]\s+/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

/** Reduce to a lowercase contiguous letter/digit run, and return the map back
 *  to original character offsets (one entry per kept letter). */
function lettersOf(s: string): { letters: string; map: number[] } {
  const letters: string[] = [];
  const map: number[] = [];
  const re = /[A-Za-z0-9]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    letters.push(m[0].toLowerCase());
    map.push(m.index);
  }
  return { letters: letters.join(''), map };
}

export interface MatchResult {
  /** Character offset (in the ORIGINAL fullText) where the matched run begins. */
  start: number;
  /** Character offset (in the ORIGINAL fullText) one past the matched run. */
  end: number;
  /** How many times the selection's letter run appears. */
  count: number;
}

/**
 * Find every occurrence of the selection's letter sequence in the document's.
 * `count` = number of true letter-sequence matches; `start`/`end` = the first
 * occurrence's original-text offsets. Only an exact contiguous letter match
 * counts, so a long sentence matches once (or genuinely multiple times if it
 * truly appears more than once), never at every sliding window.
 */
export function matchLetters(doc: string, sel: string): MatchResult | null {
  const selL = lettersOf(sel).letters;
  if (!selL) return null;
  const docL = lettersOf(doc);
  if (!docL.letters) return null;

  // Find all occurrences of sel's letter run in the doc's letter run.
  const starts: number[] = [];
  let i = docL.letters.indexOf(selL);
  while (i >= 0) {
    starts.push(i);
    i = docL.letters.indexOf(selL, i + 1);
  }
  if (starts.length === 0) return null;
  // The first occurrence spans letter indices [starts[0], starts[0]+selL.length).
  return {
    start: docL.map[starts[0]],
    end: docL.map[starts[0] + selL.length - 1] + 1,
    count: starts.length,
  };
}

/** Compute the context slice around a matched run (in the ORIGINAL text). */
export function contextRange(start: number, end: number, contextLen: number): { from: number; to: number } {
  const from = Math.max(0, start - contextLen);
  const to = end + contextLen;
  return { from, to };
}
