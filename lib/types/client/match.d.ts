/** Merge hyphen/line-break splits and collapse whitespace, lowercased (for the
 *  display copy of the selection / "原文"). */
export declare function normalizeForMatch(s: string): string;
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
export declare function matchLetters(doc: string, sel: string): MatchResult | null;
/** Compute the context slice around a matched run (in the ORIGINAL text). */
export declare function contextRange(start: number, end: number, contextLen: number): {
    from: number;
    to: number;
};
