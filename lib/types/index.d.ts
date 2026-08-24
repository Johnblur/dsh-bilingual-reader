import type { DocChunk, DocumentText, TranslateEvent, TranslateRequest } from './types.js';
export declare const inject: string[];
export interface ReaderController {
    loadDocument: (file: string) => Promise<{
        text: DocumentText;
        chunks: DocChunk[];
        glossary: Record<string, string>;
    }>;
    translateChunk: (chunkId: string, glossary: Record<string, string>, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
    translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
}
export declare function createReaderController(llm: unknown): ReaderController;
export declare function apply(ctx: {
    llm: unknown;
    effect: (fn: unknown) => unknown;
}): void;
