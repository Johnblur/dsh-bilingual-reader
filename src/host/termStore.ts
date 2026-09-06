// src/host/termStore.ts — host-side storage of the domain graph + term glossary.
// Per the plan, these are ASSETS stored on the host filesystem (not localStorage):
//   <profile>/dsh-bilingual-reader/domain-graph.json
//   <profile>/dsh-bilingual-reader/terms.json
// The store reads a seed baseline on first run, then persists user edits there.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { DomainGraph, TermEntry } from '../shared/domain.js';
import { SEED_GRAPH, SEED_TERMS } from '../shared/domainSeed.js';

export interface TermStore {
  /** Path to the asset directory (the plugin's own folder under the profile). */
  dir: string;
  graph: DomainGraph;
  terms: TermEntry[];
  load(): Promise<void>;
  saveGraph(): Promise<void>;
  saveTerms(): Promise<void>;
}

export function createTermStore(baseDir: string): TermStore {
  const dir = path.join(baseDir, 'dsh-bilingual-reader');
  const graphPath = path.join(dir, 'domain-graph.json');
  const termsPath = path.join(dir, 'terms.json');

  const store: TermStore = {
    dir,
    graph: SEED_GRAPH,
    terms: SEED_TERMS,
    async load() {
      try { await fs.mkdir(dir, { recursive: true }); } catch { /* best effort */ }
      // Load the graph if a valid file exists and passes the cycle check.
      try {
        const raw = JSON.parse(await fs.readFile(graphPath, 'utf8')) as DomainGraph;
        store.graph = raw;
      } catch { store.graph = SEED_GRAPH; }
      // Load terms if present; otherwise start from seed.
      try {
        const raw = JSON.parse(await fs.readFile(termsPath, 'utf8')) as TermEntry[];
        store.terms = Array.isArray(raw) ? raw : SEED_TERMS;
      } catch { store.terms = SEED_TERMS; }
    },
    async saveGraph() {
      try { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(graphPath, JSON.stringify(store.graph, null, 2), 'utf8'); } catch { /* ignore */ }
    },
    async saveTerms() {
      try { await fs.mkdir(dir, { recursive: true }); await fs.writeFile(termsPath, JSON.stringify(store.terms, null, 2), 'utf8'); } catch { /* ignore */ }
    },
  };

  return store;
}
