// src/index.ts — host plugin entry.
// Assemblies the host-side ReaderController (extract + chunk + glossary + isolated
// translation + cache) using the injected `llm` service (LlmRuntime).
//
// VERIFY: how `ctx.llm` is obtained (inject key 'llm') and how the controller is
// handed to the client half in your DSH build (RPC / viewer props).
import type { DocChunk, DocumentText, TranslateEvent, TranslateRequest } from './types.js';
import { extractPdf } from './host/pdf.js';
import { chunkDocument } from './host/chunk.js';
import { extractGlossary } from './host/glossary.js';
import { createLlmGateway, type LlmGateway } from './host/llmClient.js';
import { translateChunk, translateSelection } from './host/translate.js';
import { loadCache, saveCache, hashText, type CacheEntry } from './host/cache.js';

export const inject = ['llm'];

export interface ReaderController {
  loadDocument: (file: string) => Promise<{ text: DocumentText; chunks: DocChunk[]; glossary: Record<string, string> }>;
  translateChunk: (chunkId: string, glossary: Record<string, string>, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
  translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
}

export function createReaderController(llm: unknown): ReaderController {
  const gateway: LlmGateway = createLlmGateway(llm);
  const docCache = new Map<string, { chunks: DocChunk[]; glossary: Record<string, string> }>();
  let currentFile = '';

  return {
    async loadDocument(file) {
      currentFile = file;
      const text = await extractPdf(file);
      const chunks = chunkDocument(text);
      const glossary = extractGlossary(chunks);
      docCache.set(file, { chunks, glossary });
      return { text, chunks, glossary };
    },

    async translateChunk(chunkId, glossary, signal, emit) {
      const entry = [...docCache.values()].find((d) => d.chunks.some((c) => c.id === chunkId));
      const chunk = entry?.chunks.find((c) => c.id === chunkId);
      if (!chunk) throw new Error(`chunk not found: ${chunkId}`);

      const cache = await loadCache(currentFile || chunkId);
      const hash = hashText(chunk.text);
      if (cache[chunkId] && cache[chunkId].hash === hash && cache[chunkId].text) {
        emit({ type: 'done', requestId: chunkId, full: cache[chunkId].text });
        return cache[chunkId].text;
      }
      const result = await translateChunk(gateway, chunk, { kind: 'full-text', glossary, target: '中文' }, signal, emit, chunkId);
      cache[chunkId] = { hash, text: result } as CacheEntry;
      if (currentFile) await saveCache(currentFile, cache);
      emit({ type: 'done', requestId: chunkId, full: result });
      return result;
    },

    async translateSelection(req, signal, emit) {
      const requestId = `sel-${Date.now()}`;
      const result = await translateSelection(gateway, req.selection ?? '', req.context ?? '', req, signal, emit, requestId);
      emit({ type: 'done', requestId, full: result });
      return result;
    },
  };
}

export function apply(ctx: { llm: unknown; effect: (fn: unknown) => unknown }): void {
  const controller = createReaderController(ctx.llm);
  ctx.effect(() => registerHostController(controller));
}

function registerHostController(_controller: ReaderController): void {
  // TODO: publish the controller to the client half (RPC / inject / viewer prop).
  void _controller;
}
