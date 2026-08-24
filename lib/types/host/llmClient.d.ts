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
}
export declare function createLlmGateway(llm: unknown): LlmGateway;
