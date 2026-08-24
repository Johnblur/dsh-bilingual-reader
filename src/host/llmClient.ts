// host/llmClient.ts — thin adapter over DSH's `ctx.llm` (LlmRuntime).
// IMPORTANT (isolation): this is the ONLY place that touches the model, and it
// runs a STANDALONE call via prepareCall/stream — it never appends to the main
// conversation, so the main thread's context is untouched by design.
//
// VERIFY on your DSH build: the exact `messages` shape and the chunk (delta)
// shape below are written against the dsh-llm surface we inspected
// (`ctx.llm.prepareCall(config) -> { stream({messages, signal}) }`, token deltas).
// Adjust `buildMessages` / the delta picker to match your installed dsh-llm types.
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
      // dsh-llm LlmRuntime: prepareCall binds provider/model for a one-shot call.
      // TODO(verify): imports/helpers from '@deepseek-ai/dsh-llm' for message creation.
      const runtime = llm as {
        prepareCall: (cfg: { provider: string; model: string; signal?: AbortSignal }) => Promise<{
          stream: (o: { messages: unknown[]; signal?: AbortSignal }) => AsyncIterable<unknown>;
        }>;
      };
      const prepared = await runtime.prepareCall({ provider: opts.provider, model: opts.model, signal: opts.signal });
      const stream = prepared.stream({
        signal: opts.signal,
        messages: opts.messages.map((m) => ({ role: m.role, content: [{ type: 'text', text: m.text }] })),
      });
      let full = '';
      for await (const chunk of stream) {
        // Adapt raw chunk -> text delta. Confirm the chunk shape in dsh-llm.
        const delta = (chunk as { text?: string; delta?: string }).text
          ?? (chunk as { delta?: string }).delta ?? '';
        if (typeof delta === 'string' && delta.length) {
          full += delta;
          opts.emit({ type: 'delta', requestId: opts.requestId, text: delta });
        }
      }
      return full;
    },
  };
}
