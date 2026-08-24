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
interface ReactPieces {
    h: (...args: any[]) => any;
    useState: (...args: any[]) => any;
    useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
    useCallback: <T>(fn: T, deps: any[]) => T;
}
export declare function makeReader({ h, useState, useEffect, useCallback }: ReactPieces): (props: {
    file?: string;
    controller?: ReaderController;
}) => any;
export {};
