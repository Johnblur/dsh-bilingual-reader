import type { DocumentText, TranslateRequest } from '../types.js';
export interface ReaderController {
    loadDocument: (file: string) => Promise<{
        text: DocumentText;
        chunks: unknown[];
        glossary: Record<string, string>;
    }>;
    translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: unknown) => void) => Promise<string>;
    /** Classify a snippet's language (may be a no-op when the LLM path is unused). */
    detectLanguage?: (text: string) => Promise<string>;
    /** Classify a snippet's field/domain (shown when the domain is unspecified). */
    detectDomain?: (text: string) => Promise<string>;
    /** Query domain terms for injection + dev warnings. */
    queryTerms?: (req: {
        domain: string;
        sourceLang: string;
        targetLang?: string;
        text?: string;
    }) => Promise<{
        hits: any[];
        warnings: string[];
    }>;
}
interface ReactPieces {
    h: (...args: any[]) => any;
    useState: (...args: any[]) => any;
    useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
    useCallback: <T>(fn: T, deps: any[]) => T;
    useRef: <T>(init: T) => {
        current: T;
    };
}
export declare function makeReader({ h, useState, useEffect, useCallback, useRef }: ReactPieces): (props: {
    file?: string;
    controller?: ReaderController;
}) => any;
export {};
