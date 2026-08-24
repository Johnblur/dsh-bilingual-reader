// host/glossary.ts — terminology extraction for consistent translation.
// Pure logic: finds CamelCase terms + all-caps acronyms + common domain terms,
// seeding a glossary the model is asked to keep consistent. Values start as the
// term itself (identity); the user can edit them in the UI later.
import type { DocChunk } from '../types.js';

const CAMEL = /\b[A-Z][a-z]+(?:[A-Z][a-z]*)+/g;             // e.g. DeepSeekMoE, JanusFlow (allows trailing single capital)
const ACRONYM = /\b[A-Z]{2,8}\b/g;                          // e.g. MLA, MoE, RL, DSL, RAG
const KEPT = /^(?:[A-Za-z]+)$/;

const STOP = new Set([
  'THE','AND','OR','FOR','OF','IN','ON','WITH','A','AN','IS','ARE','TO','BY','AS','AT',
  'FROM','That','This','These','Those','Using','Based','Model','Models','We','Our',
]);

export function extractGlossary(chunks: DocChunk[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of chunks) {
    collect(c.text, out);
    if (c.sourceText) collect(c.sourceText, out);
  }
  return out;
}

function collect(text: string, out: Record<string, string>): void {
  for (const m of text.matchAll(CAMEL)) {
    const t = m[0];
    if (t.length >= 5 && !STOP.has(t)) out[t] = t;
  }
  for (const m of text.matchAll(ACRONYM)) {
    const t = m[0];
    if (t.length >= 3 && !STOP.has(t) && KEPT.test(t)) out[t] = t;
  }
}
