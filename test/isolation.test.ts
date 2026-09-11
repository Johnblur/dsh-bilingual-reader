// test/isolation.test.ts
// Demonstrates the ISOLATION guarantee: translation only ever goes through the
// injected LlmGateway with plugin-built messages — it never references or appends
// to any main-conversation object.
import { describe, it, expect } from 'vitest';
import { translateSelection } from '../src/host/translate.js';
import type { LlmGateway, LlmMessage } from '../src/host/llmClient.js';

function fakeGateway(): { gateway: LlmGateway; calls: LlmMessage[][] } {
  const calls: LlmMessage[][] = [];
  const gateway: LlmGateway = {
    async streamText(opts) {
      calls.push(opts.messages);
      opts.emit({ type: 'delta', requestId: opts.requestId, text: '译' });
      opts.emit({ type: 'delta', requestId: opts.requestId, text: '文' });
      return '译文';
    },
    // The gateway gained classification methods after this test was written; the
    // counts below assert that TRANSLATION never consults them (they must only
    // ever be reached from the language/domain pickers).
    async detectLanguage() { throw new Error('unexpected detectLanguage call'); },
    async classify() { throw new Error('unexpected classify call'); },
  };
  return { gateway, calls };
}

describe('isolation: translation never touches the main conversation', () => {
  it('selection translation builds its messages from the document + glossary only', async () => {
    const { gateway, calls } = fakeGateway();
    await translateSelection(
      gateway,
      'MoE',
      'DeepSeekMoE uses MLA. The mixture-of-experts model routes tokens.',
      { kind: 'selection', glossary: { MLA: 'MLA' }, target: '中文' },
      new AbortController().signal,
      () => {},
      's1',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0][0].role).toBe('system');
    // The glossary and the chosen domain reach the prompt…
    expect(calls[0][0].text).toContain('MLA=MLA');
    const user = calls[0][1].text;
    expect(user).toContain('选中片段');
    expect(user).toContain('MoE');
    expect(user).toContain('上下文');
    expect(user).toContain('mixture-of-experts'); // context is included
    // …and nothing else is ever passed: no conversation, no extra messages.
    expect(calls[0]).toHaveLength(2);
  });
});
