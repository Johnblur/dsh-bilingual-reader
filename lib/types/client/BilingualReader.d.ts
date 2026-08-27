import type { DocChunk, DocumentText, TranslateEvent, TranslateRequest } from '../types.js';
export interface ReaderController {
    loadDocument: (file: string) => Promise<{
        text: DocumentText;
        chunks: DocChunk[];
        glossary: Record<string, string>;
    }>;
    translateChunk: (chunkId: string, glossary: Record<string, string>, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
    translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
}
export declare function BilingualReader(props: {
    file?: string;
    controller?: ReaderController;
}): JSX.Element;
