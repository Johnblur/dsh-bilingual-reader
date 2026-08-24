// host/model.ts — per-mode model routing.
// Pure logic: pick a provider/model per translation kind, with per-request override.
import type { TranslateRequest } from '../types.js';

export interface ModelTarget { provider: string; model: string }

export interface ModelConfig {
  fullText: ModelTarget;     // strong / high quality
  selection: ModelTarget;    // fast / cheap
}

// Follows DSH's configured deepseek models by default; overridable via plugin settings.
export const DEFAULT_MODELS: ModelConfig = {
  fullText: { provider: 'deepseek', model: 'deepseek-ai/DeepSeek-V3.2' },
  selection: { provider: 'deepseek', model: 'deepseek-ai/DeepSeek-V4-Flash' },
};

export function resolveModel(req: TranslateRequest, cfg: ModelConfig = DEFAULT_MODELS): ModelTarget {
  const base = req.kind === 'selection' ? cfg.selection : cfg.fullText;
  return {
    provider: req.provider ?? base.provider,
    model: req.model ?? base.model,
  };
}
