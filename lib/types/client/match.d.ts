/** Merge hyphen/line-break splits and collapse whitespace, lowercased. */
export declare function normalizeForMatch(s: string): string;
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
export declare function fuzzyMatch(doc: string, sel: string, threshold?: number): MatchResult | null;
/** Compute the context slice around a matched start (in the normalized doc). */
export declare function contextRange(start: number, sel: string, contextLen: number): {
    from: number;
    to: number;
};
