// host/translate.ts — translation orchestrator (full-text + selection).
// Only talks to the isolated LlmGateway; never writes to the main conversation.
import type { DocChunk, TranslateEvent, TranslateRequest } from '../types.js';
import type { LlmGateway, LlmMessage } from './llmClient.js';
import { resolveModel } from './model.js';

const SYSTEM_FULLTEXT = (glossary: Record<string, string>, target: string) =>
  `你是学术论文翻译助手。把下面内容译成${target}。只输出译文，不要解释、不要保留原文。` +
  glossaryNote(glossary);

const SYSTEM_SELECTION = (glossary: Record<string, string>, target: string) =>
  `你是学术论文翻译助手。请结合给出的“上下文”理解以下“选中片段”的含义，把选中片段译成${target}。` +
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
    { role: 'system', text: SYSTEM_FULLTEXT(req.glossary ?? {}, target) },
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
    { role: 'system', text: SYSTEM_SELECTION(req.glossary ?? {}, target) },
    { role: 'user', text: `【上下文】\n${context}\n\n【选中片段】\n${selection}` },
  ];
  emit({ type: 'start', requestId });
  return llm.streamText({ provider, model, messages, signal, emit, requestId });
}
