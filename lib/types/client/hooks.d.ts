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
export declare function buildSelectionContext(selection: string, docText: string, paragraphs: Array<{
    start: number;
    end: number;
}>, windowSize?: number): SelectionContext;
/** Subscribe to host-driven translation events and accumulate the streamed text. */
export declare function useTranslationStream(): {
    state: Record<string, string>;
    start: (requestId: string) => void;
    push: (e: TranslateEvent) => void;
};
