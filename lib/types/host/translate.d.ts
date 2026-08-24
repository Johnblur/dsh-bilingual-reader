import type { DocChunk, TranslateEvent, TranslateRequest } from '../types.js';
import type { LlmGateway } from './llmClient.js';
export declare function translateChunk(llm: LlmGateway, chunk: DocChunk, req: TranslateRequest, signal: AbortSignal, emit: (e: TranslateEvent) => void, requestId: string): Promise<string>;
export declare function translateSelection(llm: LlmGateway, selection: string, context: string, req: TranslateRequest, signal: AbortSignal, emit: (e: TranslateEvent) => void, requestId: string): Promise<string>;
