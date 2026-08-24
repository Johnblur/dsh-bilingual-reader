// test/isolation.test.ts
// Demonstrates the ISOLATION guarantee: translation (full-text + selection) only
// ever goes through the injected LlmGateway with plugin-built messages — it never
// references or appends to any main-conversation object.
import { describe, it, expect } from 'vitest';
import { translateChunk, translateSelection } from '../src/host/translate.js';
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
  };
  return { gateway, calls };
}

describe('isolation: translation never touches the main conversation', () => {
  it('full-text translateChunk uses only the gateway with doc-built messages', async () => {
    const { gateway, calls } = fakeGateway();
    const events: string[] = [];
    const out = await translateChunk(
      gateway,
      { id: 'c1', level: 1, heading: 'Results', text: 'DeepSeekMoE uses MLA and RL.', sourceText: '' },
      { kind: 'full-text', glossary: { MLA: 'MLA', RL: 'RL' }, target: '中文' },
      new AbortController().signal,
      (e) => events.push(e.type),
      'r1',
    );
    expect(out).toBe('译文');
    expect(calls).toHaveLength(1);
    // messages are constructed only from the document + glossary (no conversation)
    expect(calls[0][0].role).toBe('system');
    expect(calls[0][0].text).toContain('MLA=MLA');
    expect(calls[0][1].role).toBe('user');
    expect(calls[0][1].text).toContain('DeepSeekMoE');
    expect(events[0]).toBe('start');
    expect(events).toContain('delta');
  });

  it('selection translation sends selection + surrounding context, not the bare selection', async () => {
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
    const user = calls[0][1].text;
    expect(user).toContain('选中片段');
    expect(user).toContain('MoE');
    expect(user).toContain('上下文');
    expect(user).toContain('mixture-of-experts'); // context is included
  });
});
