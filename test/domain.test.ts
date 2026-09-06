// test/domain.test.ts — unit tests for the domain model (DAG closure + glossary query).
import { describe, it, expect } from 'vitest';
import {
  ancestorClosure, hasCycle, queryTerms,
  type DomainGraph, type TermEntry,
} from '../src/shared/domain.js';
import { SEED_GRAPH, SEED_TERMS } from '../src/shared/domainSeed.js';

describe('DAG ancestor closure', () => {
  it('collects ancestors transitively and is cycle-safe', () => {
    expect(hasCycle(SEED_GRAPH)).toBe(false);
    const cv = ancestorClosure('computer-vision', SEED_GRAPH);
    // computer-vision ← deep-learning ← machine-learning ← computer-science
    expect(cv).toContain('computer-vision');
    expect(cv).toContain('deep-learning');
    expect(cv).toContain('machine-learning');
    expect(cv).toContain('computer-science');
    // biology is reachable via the bioinformatics→machine-learning cross edge
    expect(cv).toContain('biology');
  });
});

describe('glossary query', () => {
  it('returns a unique translation for a word locked to a domain (cell: biology vs CV)', () => {
    const bio = queryTerms('biology', 'en', 'cell', SEED_GRAPH, SEED_TERMS, 'zh');
    expect(bio.hits.length).toBeGreaterThan(0);
    expect(bio.hits[0].target).toBe('细胞');

    const cv = queryTerms('computer-vision', 'en', 'cell', SEED_GRAPH, SEED_TERMS, 'zh');
    expect(cv.hits.length).toBeGreaterThan(0);
    // With "directlyInDomain wins" the CV cell is chosen, not biology's.
    expect(cv.hits[0].target).toBe('单元（网络单元）');
  });

  it('matches a term by substring and pins the source+target language', () => {
    const res = queryTerms('machine-learning', 'en', 'gradient', SEED_GRAPH, SEED_TERMS, 'zh');
    const hit = res.hits.find((h) => h.source === 'gradient');
    expect(hit).toBeDefined();
    expect(hit!.target).toBe('梯度');
  });

  it('reports a warning when the same form maps to multiple targets in one domain', () => {
    // Force a data conflict by injecting a duplicate entry.
    const dup: TermEntry = {
      id: 't_cell_bio_dup', domains: ['biology'], terms: { en: 'cell', zh: '细胞（重复）' },
      confidence: 0.5, confirmedByUser: false, source: 'user', firstSeen: Date.now(),
    };
    const res = queryTerms('biology', 'en', 'cell', SEED_GRAPH, [...SEED_TERMS, dup], 'zh');
    expect(res.warnings.some((w) => w.includes('术语冲突'))).toBe(true);
  });
});
