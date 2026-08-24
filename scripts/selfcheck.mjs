// scripts/selfcheck.mjs — validate the PURE-LOGIC modules through Node TS type-stripping.
// (Vitest can't run in the DSH sandbox because it spawns child processes -> spawn EPERM.
//  This runs the pure functions without child processes. Note: Node type-stripping only
//  resolves the `.js` specifiers of *type-only* imports, so value-importing modules like
//  translate.ts are excluded here — those are covered by test/isolation.test.ts (vitest).)
import assert from 'node:assert';
import { chunkDocument } from '../src/host/chunk.ts';
import { extractGlossary } from '../src/host/glossary.ts';
import { buildSelectionContext } from '../src/client/hooks.ts';
import { hashText } from '../src/host/cache.ts';
import { resolveModel } from '../src/host/model.ts';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok -', name); };

// chunkDocument
t('chunkDocument splits by headings', () => {
  const doc = { file: 'a.pdf', source: 'pdf', fullText: '# Intro\nhi\n\n# Method\nstep one\nstep two\n\n# Results\nok\n', paragraphs: [] };
  const chunks = chunkDocument(doc);
  assert.deepStrictEqual(chunks.map((c) => c.heading), ['Intro', 'Method', 'Results']);
  assert.ok(chunks[1].text.includes('step one'));
});

// extractGlossary
t('extractGlossary finds CamelCase + acronyms', () => {
  const g = extractGlossary([{ id: 'c1', level: 1, heading: '', text: 'DeepSeekMoE uses MLA and RL.', sourceText: '' }]);
  assert.strictEqual(g['DeepSeekMoE'], 'DeepSeekMoE');
  assert.strictEqual(g['MLA'], 'MLA');
  assert.strictEqual(g['RL'], undefined);
});

// buildSelectionContext
t('buildSelectionContext returns selection plus neighbors', () => {
  const docText = 'A\n\nB\n\nC\n\nD\n\nE';
  const paragraphs = [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 4, end: 5 }, { start: 6, end: 7 }, { start: 8, end: 9 }];
  const { selection, context } = buildSelectionContext('C', docText, paragraphs, 1);
  assert.strictEqual(selection, 'C');
  assert.ok(context.includes('B'));
  assert.ok(context.includes('D'));
});

// hashText / resolveModel
t('hashText deterministic, resolveModel per kind', () => {
  assert.strictEqual(hashText('x'), hashText('x'));
  const ft = resolveModel({ kind: 'full-text' });
  const sel = resolveModel({ kind: 'selection' });
  assert.notStrictEqual(ft.model, sel.model);
});

console.log('\nSELF-CHECK PASS (' + pass + ' assertions grouped)');
