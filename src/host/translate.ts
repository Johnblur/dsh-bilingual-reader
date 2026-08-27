// host/translate.ts — translation orchestrator (full-text + selection).
// Only talks to the isolated LlmGateway; never writes to the main conversation.
import type { DocChunk, TranslateEvent, TranslateRequest } from '../types.js';
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

const SYSTEM_FULLTEXT = (glossary: Record<string, string>, source: string | undefined, target: string) =>
  `你是学术论文翻译助手。下面的内容语言是「${sourceOf(source)}」，请把它译成${target}。只输出译文，不要解释、不要保留原文。` +
  glossaryNote(glossary);

const SYSTEM_SELECTION = (glossary: Record<string, string>, source: string | undefined, target: string) =>
  `你是学术论文翻译助手。请结合给出的“上下文”理解以下“选中片段”的含义，把选中片段从「${sourceOf(source)}」译成${target}。` +
  `不要翻译上下文，只翻译选中片段；上下文仅用于确定用词。` + glossaryNote(glossary);

function glossaryNote(g: Record<string, string>): string {
  const keys = Object.keys(g);
  if (keys.length === 0) return '';
  const map = keys.map((k) => `${k}=${g[k] ?? k}`).join(', ');
  return `\n术语请保持一致：${map}`;
}

// --- Full-text: translate one section chunk, streaming deltas. Cache-aware. ---
export async function translateChunk(
  llm: LlmGateway,
  chunk: DocChunk,
  req: TranslateRequest,
  signal: AbortSignal,
  emit: (e: TranslateEvent) => void,
  requestId: string,
): Promise<string> {
  const { provider, model } = resolveModel({ ...req, kind: 'full-text' });
  const target = req.target ?? '中文';
  const messages: LlmMessage[] = [
    { role: 'system', text: SYSTEM_FULLTEXT(req.glossary ?? {}, req.source, target) },
    { role: 'user', text: chunk.heading ? `【标题】${chunk.heading}\n\n${chunk.text}` : chunk.text },
  ];
  emit({ type: 'start', requestId });
  return llm.streamText({ provider, model, messages, signal, emit, requestId });
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
    { role: 'system', text: SYSTEM_SELECTION(req.glossary ?? {}, req.source, target) },
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
