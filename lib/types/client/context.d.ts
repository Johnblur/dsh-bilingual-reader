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
export declare function buildSelectionContext(selection: string, docText: string, windowChars?: number): SelectionContext;
/**
 * Paragraph-window variant (kept for API stability). Prefer buildSelectionContext.
 */
export declare function buildSelectionContextParagraphs(selection: string, docText: string, _paragraphs: Array<{
    start: number;
    end: number;
}>, _windowSize?: number): SelectionContext;
