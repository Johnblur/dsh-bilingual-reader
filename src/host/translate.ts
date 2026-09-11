// host/translate.ts — translation orchestrator (selection + classifiers).
// Only talks to the isolated LlmGateway; never writes to the main conversation.
import type { TranslateEvent, TranslateRequest } from '../types.js';
import type { LlmGateway, LlmMessage } from './llmClient.js';
import { resolveModel } from './model.js';

// Source-aware prompt. When we know the source language we say so explicitly,
// which measurably improves small-language mutual translation (the model won't
// treat e.g. French as Japanese). When source is unknown we let the model
// judge it — the same behavior as before, so it never regresses.
function sourceOf(source: string | undefined): string {
  const s = source?.trim();
  return s ? s : '自动判断的原文语言';
}

const SYSTEM_SELECTION = (glossary: Record<string, string>, source: string | undefined, target: string, domain?: string) =>
  `你是学术论文翻译助手。请结合给出的“上下文”理解以下“选中片段”的含义，把选中片段从「${sourceOf(source)}」译成${target}。` +
  `不要翻译上下文，只翻译选中片段；上下文仅用于确定用词。` + domainNote(domain) + glossaryNote(glossary);

function domainNote(domain: string | undefined): string {
  return domain ? `\n【所属领域】${domain}` : '';
}

function glossaryNote(g: Record<string, string>): string {
  const keys = Object.keys(g);
  if (keys.length === 0) return '';
  const map = keys.map((k) => `${k}=${g[k] ?? k}`).join(', ');
  return `\n术语请保持一致：${map}`;
}

// --- Selection: translate the selection using a surrounding context window. ---
export async function translateSelection(
  llm: LlmGateway,
  selection: string,
  context: string,
  req: TranslateRequest,
  signal: AbortSignal,
  emit: (e: TranslateEvent) => void,
  requestId: string,
): Promise<string> {
  const { provider, model } = resolveModel({ ...req, kind: 'selection' });
  const target = req.target ?? '中文';
  const messages: LlmMessage[] = [
    { role: 'system', text: SYSTEM_SELECTION(req.glossary ?? {}, req.source, target, req.domain) },
    { role: 'user', text: `【上下文】\n${context}\n\n【选中片段】\n${selection}` },
  ];
  emit({ type: 'start', requestId });
  return llm.streamText({ provider, model, messages, signal, emit, requestId });
}

// --- Language detection: classify a snippet's language (no translation). ---
export async function detectTextLanguage(
  llm: LlmGateway,
  text: string,
  overrides?: { provider?: string; model?: string },
): Promise<string> {
  const { provider, model } = resolveModel({ kind: 'selection', provider: overrides?.provider, model: overrides?.model });
  return llm.detectLanguage({ provider, model, text });
}

// --- Domain detection: classify a paper/snippet's field (no translation). ---
// Returns a normalized domain slug (lowercase, dashes) or '' when unknown.
export async function detectDomain(
  llm: LlmGateway,
  text: string,
  overrides?: { provider?: string; model?: string },
): Promise<string> {
  const { provider, model } = resolveModel({ kind: 'selection', provider: overrides?.provider, model: overrides?.model });
  const raw = await llm.classify({
    provider,
    model,
    system:
      'You are a paper-field classifier. Given a snippet from an academic paper, answer ONLY with the most specific domain, as a short English slug, e.g. "machine-learning", "deep-learning", "nlp", "computer-vision", "reinforcement-learning", "biology", "genetics", "physics", "quantum-computing", "software-engineering", "math", or "other". No explanation, no translation.',
    user: text.slice(0, 4000),
    purpose: 'domain-detect',
  });
  const slug = (raw || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return slug || '';
}
