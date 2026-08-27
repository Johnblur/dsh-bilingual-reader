import type { TranslateRequest } from '../types.js';
export interface ModelTarget {
    provider: string;
    model: string;
}
export interface ModelConfig {
    fullText: ModelTarget;
    selection: ModelTarget;
}
export declare const DEFAULT_MODELS: ModelConfig;
export declare function resolveModel(req: TranslateRequest, cfg?: ModelConfig): ModelTarget;
