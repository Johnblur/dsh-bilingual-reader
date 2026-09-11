// scripts/selfcheck.mjs — validate the PURE-LOGIC modules through Node TS type-stripping.
// (Vitest can't run in the DSH sandbox because it spawns child processes -> spawn EPERM.
//  This runs the pure functions without child processes. Note: Node type-stripping only
//  resolves the `.js` specifiers of *type-only* imports, so value-importing modules like
//  translate.ts are excluded here — those are covered by test/isolation.test.ts (vitest).)
import assert from 'node:assert';
import { chunkDocument } from '../src/host/chunk.ts';
import { extractGlossary } from '../src/host/glossary.ts';
import { matchLetters, contextRange } from '../src/client/match.ts';
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

// matchLetters / contextRange
t('matchLetters locates a selection by its letter run', () => {
  const doc = 'Intro text. The RoPE trick rotates queries. More text.';
  const m = matchLetters(doc, 'RoPE trick rotates');
  assert.ok(m, 'expected a match');
  assert.strictEqual(doc.slice(m.start, m.end), 'RoPE trick rotates');
  assert.strictEqual(m.count, 1);
  // Punctuation/whitespace differences must not break the match.
  const loose = matchLetters(doc, 'rope   trick, rotates');
  assert.ok(loose, 'expected a whitespace/punctuation-insensitive match');
  assert.strictEqual(doc.slice(loose.start, loose.end), 'RoPE trick rotates');
  assert.strictEqual(matchLetters(doc, 'not in the document'), null);
});

t('contextRange widens symmetrically and clamps at 0', () => {
  assert.deepStrictEqual(contextRange(100, 120, 50), { from: 50, to: 170 });
  assert.deepStrictEqual(contextRange(10, 20, 50), { from: 0, to: 70 });
});

// hashText / resolveModel
t('hashText deterministic, resolveModel honours config and overrides', () => {
  assert.strictEqual(hashText('x'), hashText('x'));
  const cfg = { fullText: { provider: 'p1', model: 'm1' }, selection: { provider: 'p2', model: 'm2' } };
  assert.deepStrictEqual(resolveModel({ kind: 'full-text' }, cfg), { provider: 'p1', model: 'm1' });
  assert.deepStrictEqual(resolveModel({ kind: 'selection' }, cfg), { provider: 'p2', model: 'm2' });
  // A per-request model wins; the provider still comes from the config.
  assert.deepStrictEqual(resolveModel({ kind: 'selection', model: 'override' }, cfg), { provider: 'p2', model: 'override' });
  // Defaults resolve to a usable target for both modes.
  assert.ok(resolveModel({ kind: 'full-text' }).model);
  assert.ok(resolveModel({ kind: 'selection' }).provider);
});

console.log('\nSELF-CHECK PASS (' + pass + ' assertions grouped)');
