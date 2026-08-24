// host/llmClient.ts — adapter over DSH's `ctx.llm` (LlmRuntime), following the proven
// standalone pattern DSH itself uses (session-title-llm): deepFreeze(options) with
// provider/model/messages/system/maxTokens/sessionId/purpose/signal, then
// `ctx.llm.stream(options)` + BlockAssembler. ISOLATION: never appends to the main
// conversation — it is an independent stream call.
import { createUserMessage, createAssistantMessage, BlockAssembler, deepFreeze } from '@deepseek-ai/dsh-llm';
import type { TranslateEvent } from '../types.js';

export interface LlmMessage { role: 'system' | 'user' | 'assistant'; text: string }

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

export function createLlmGateway(llm: unknown): LlmGateway {
  return {
    async streamText(opts) {
      const runtime = llm as { stream: (options: unknown) => AsyncIterable<unknown> };
      const system = opts.messages.filter((m) => m.role === 'system').map((m) => m.text).join('\n');
      const messages = opts.messages.filter((m) => m.role !== 'system').map((m) =>
        m.role === 'assistant'
          ? createAssistantMessage({ content: [{ type: 'text', text: m.text }], source: { kind: 'plugin', plugin: 'dsh-bilingual-reader', provider: opts.provider, model: opts.model } })
          : createUserMessage({ content: [{ type: 'text', text: m.text }], source: { kind: 'plugin', plugin: 'dsh-bilingual-reader' } }),
      );
      const options = deepFreeze({
        provider: opts.provider,
        model: opts.model,
        messages,
        ...(system ? { system } : {}),
        maxTokens: 4096,
        sessionId: 'bilingual-reader',
        purpose: 'translation',
        signal: opts.signal,
      });
      const assembler = new BlockAssembler();
      for await (const chunk of runtime.stream(options)) {
        assembler.push(chunk);
      }
      const f = assembler.finish as { kind: string; failure?: { message?: string } };
      if (f && (f.kind === 'error' || f.kind === 'aborted')) {
        throw new Error(f.failure?.message || `llm stream ${f.kind}`);
      }
      const blocks = assembler.blocks();
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join(' ').trim();
      opts.emit({ type: 'done', requestId: opts.requestId, full: text });
      return text;
    },
  };
}
