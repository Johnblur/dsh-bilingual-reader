// host/model.ts — per-mode model routing.
// Uses your DSH-configured model by default (provider 'deepseek-official', model
// 'deepseek-v4-flash-vision-exp'); overridable via env or per-request.
import type { TranslateRequest } from '../types.js';

export interface ModelTarget { provider: string; model: string }

export interface ModelConfig {
  fullText: ModelTarget;
  selection: ModelTarget;
}

const PROVIDER = process.env.DSH_BILINGUAL_PROVIDER ?? 'deepseek-official';
const MODEL = process.env.DSH_BILINGUAL_MODEL ?? 'deepseek-v4-flash-vision-exp';

export const DEFAULT_MODELS: ModelConfig = {
  fullText: { provider: PROVIDER, model: MODEL },
  selection: { provider: PROVIDER, model: MODEL },
};

export function resolveModel(req: TranslateRequest, cfg: ModelConfig = DEFAULT_MODELS): ModelTarget {
  const base = req.kind === 'selection' ? cfg.selection : cfg.fullText;
  return {
    provider: req.provider ?? base.provider,
    model: req.model ?? base.model,
  };
}
