// test/pure.test.ts — unit tests for the pure-logic modules.
import { describe, it, expect } from 'vitest';
import { chunkDocument } from '../src/host/chunk.js';
import { extractGlossary } from '../src/host/glossary.js';
import { buildSelectionContext } from '../src/client/hooks.js';
import { hashText } from '../src/host/cache.js';
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

describe('buildSelectionContext', () => {
  it('returns the selection plus neighboring paragraphs', () => {
    const docText = 'A\n\nB\n\nC\n\nD\n\nE';
    const paragraphs = [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }, { start: 6, end: 7 }, { start: 8, end: 9 }];
    const { selection, context } = buildSelectionContext('C', docText, paragraphs, 1);
    expect(selection).toBe('C');
    expect(context).toContain('B');
    expect(context).toContain('D');
  });
});

describe('hashText / resolveModel', () => {
  it('hashes deterministically and routes per kind', () => {
    expect(hashText('x')).toBe(hashText('x'));
    const ft = resolveModel({ kind: 'full-text' });
    const sel = resolveModel({ kind: 'selection' });
    expect(ft.model).not.toBe(sel.model);
  });
});
