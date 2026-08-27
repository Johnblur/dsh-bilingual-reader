import type { TranslateEvent } from '../types.js';
export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    text: string;
}
export interface LlmGateway {
    streamText(opts: {
        provider: string;
        model: string;
        messages: LlmMessage[];
        signal?: AbortSignal;
        emit: (e: TranslateEvent) => void;
        requestId: string;
    }): Promise<string>;
    /** Classify a text snippet's language. Distinct from translation: the model
     *  is asked only to name the language (ISO 639-1), not translate it. No UI
     *  emit — the result feeds the source-language dropdown. */
    detectLanguage(opts: {
        provider: string;
        model: string;
        text: string;
        signal?: AbortSignal;
    }): Promise<string>;
}
export declare function createLlmGateway(llm: unknown): LlmGateway;
