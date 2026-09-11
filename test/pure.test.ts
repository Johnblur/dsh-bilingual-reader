// test/pure.test.ts — unit tests for the pure-logic modules.
// Mirrors scripts/selfcheck.mjs; keep the two in step. (selfcheck exists because
// Vitest cannot run inside the DSH sandbox — it spawns child processes.)
import { describe, it, expect } from 'vitest';
import { chunkDocument } from '../src/host/chunk.js';
import { extractGlossary } from '../src/host/glossary.js';
import { matchLetters, contextRange } from '../src/client/match.js';
import { resolveModel } from '../src/host/model.js';

describe('chunkDocument', () => {
  it('splits text by headings into sections', () => {
    const doc = {
      file: 'a.pdf', source: 'pdf',
      fullText: '# Intro\nhello world\n\n# Method\nstep one\nstep two\n\n# Results\nok\n',
      paragraphs: [],
    } as Parameters<typeof chunkDocument>[0];
    const chunks = chunkDocument(doc);
    expect(chunks.map((c) => c.heading)).toEqual(['Intro', 'Method', 'Results']);
    expect(chunks[1].text).toContain('step one');
  });
});

describe('extractGlossary', () => {
  it('finds CamelCase terms and acronyms', () => {
    const g = extractGlossary([{ id: 'c1', level: 1, heading: '', text: 'DeepSeekMoE uses MLA and RL.', sourceText: '' }]);
    expect(g['DeepSeekMoE']).toBe('DeepSeekMoE');
    expect(g['MLA']).toBe('MLA');
    expect(g['RL']).toBeUndefined(); // 2-letter acronym filtered out
  });
});

describe('matchLetters', () => {
  it('locates a selection by its letter run', () => {
    const doc = 'Intro text. The RoPE trick rotates queries. More text.';
    const m = matchLetters(doc, 'RoPE trick rotates');
    expect(m).not.toBeNull();
    expect(doc.slice(m!.start, m!.end)).toBe('RoPE trick rotates');
    expect(m!.count).toBe(1);
    // Punctuation/whitespace differences must not break the match.
    const loose = matchLetters(doc, 'rope   trick, rotates');
    expect(loose).not.toBeNull();
    expect(doc.slice(loose!.start, loose!.end)).toBe('RoPE trick rotates');
    expect(matchLetters(doc, 'not in the document')).toBeNull();
  });
});

describe('contextRange', () => {
  it('widens symmetrically and clamps at 0', () => {
    expect(contextRange(100, 120, 50)).toEqual({ from: 50, to: 170 });
    expect(contextRange(10, 20, 50)).toEqual({ from: 0, to: 70 });
  });
});

describe('resolveModel', () => {
  it('honours config and per-request overrides', () => {
    const cfg = { fullText: { provider: 'p1', model: 'm1' }, selection: { provider: 'p2', model: 'm2' } };
    expect(resolveModel({ kind: 'full-text' }, cfg)).toEqual({ provider: 'p1', model: 'm1' });
    expect(resolveModel({ kind: 'selection' }, cfg)).toEqual({ provider: 'p2', model: 'm2' });
    // A per-request model wins; the provider still comes from the config.
    expect(resolveModel({ kind: 'selection', model: 'override' }, cfg)).toEqual({ provider: 'p2', model: 'override' });
    // Defaults resolve to a usable target for both modes.
    expect(resolveModel({ kind: 'full-text' }).model).toBeTruthy();
    expect(resolveModel({ kind: 'selection' }).provider).toBeTruthy();
  });
});
