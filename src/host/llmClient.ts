// host/llmClient.ts — thin adapter over DSH's `ctx.llm` (LlmRuntime).
// ISOLATION: this is the only place that touches the model; it runs a STANDALONE
// prepareCall/stream and never appends to the main conversation.
// Messages are built with dsh-llm's own creators (frozen messages with content
// blocks + source), which the adapter requires.
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm';
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
      const runtime = llm as {
        prepareCall: (cfg: { provider: string; model: string; signal?: AbortSignal }) => Promise<{
          stream: (o: { messages: unknown[]; signal?: AbortSignal }) => AsyncIterable<unknown>;
        }>;
      };
      const prepared = await runtime.prepareCall({ provider: opts.provider, model: opts.model, signal: opts.signal });
      const stream = prepared.stream({
        signal: opts.signal,
        messages: opts.messages.map((m) =>
          m.role === 'assistant'
            ? createAssistantMessage({ content: [{ type: 'text', text: m.text }], source: { provider: opts.provider, model: opts.model } })
            : createUserMessage({ content: [{ type: 'text', text: m.text }] }),
        ),
      });
      let full = '';
      for await (const chunk of stream) {
        const c = chunk as { text?: string; delta?: string };
        const delta = typeof c?.text === 'string' ? c.text : (typeof c?.delta === 'string' ? c.delta : '');
        if (delta) {
          full += delta;
          opts.emit({ type: 'delta', requestId: opts.requestId, text: delta });
        }
      }
      return full;
    },
  };
}
