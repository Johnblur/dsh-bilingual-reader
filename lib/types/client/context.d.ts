export interface SelectionContext {
    selection: string;
    context: string;
}
/**
 * Build the context window for a highlighted selection: the paragraph containing
 * the selection ± `windowSize` neighboring paragraphs (default 1). This satisfies
 * "translation must use document context, not just the bare selection."
 */
export declare function buildSelectionContext(selection: string, docText: string, paragraphs: Array<{
    start: number;
    end: number;
}>, windowSize?: number): SelectionContext;
