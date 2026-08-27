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
  /** Classify a text snippet's language. Distinct from translation: the model
   *  is asked only to name the language (ISO 639-1), not translate it. No UI
   *  emit — the result feeds the source-language dropdown. */
  detectLanguage(opts: {
    provider: string;
    model: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<string>;
}

export function createLlmGateway(llm: unknown): LlmGateway {
  // Run a one-shot LLM round (independent stream call, never touches the main
  // conversation). Returns the concatenated text blocks.
  async function runOnce(opts: {
    provider: string;
    model: string;
    messages: LlmMessage[];
    signal?: AbortSignal;
    purpose: string;
    requestId: string;
  }): Promise<string> {
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
      purpose: opts.purpose,
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
    return blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join(' ').trim();
  }

  return {
    async streamText(opts) {
      const text = await runOnce({ ...opts, purpose: 'translation', requestId: opts.requestId });
      opts.emit({ type: 'done', requestId: opts.requestId, full: text });
      return text;
    },
    async detectLanguage(opts) {
      // Ask only for the language name; no translation. Keep the answer to a
      // short ISO code so the dropdown can match it cleanly.
      const raw = await runOnce({
        provider: opts.provider,
        model: opts.model,
        messages: [
          { role: 'system', text: 'You are a language detector. Read the text and answer ONLY with the ISO 639-1 language code (e.g. \"en\", \"fr\", \"zh\"). No explanation, no translation.' },
          { role: 'user', text: opts.text.slice(0, 2000) },
        ],
        signal: opts.signal,
        purpose: 'language-detect',
        requestId: 'detect-' + Date.now(),
      });
      // Trim to the first 2-3 letter token that looks like a code.
      const m = /[A-Za-z]{2,3}/.exec(raw || '');
      return m ? m[0].toLowerCase() : (raw || '').toLowerCase();
    },
  };
}
