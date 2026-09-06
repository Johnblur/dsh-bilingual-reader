// src/shared/domain.ts — domain model + multilingual term glossary (pure logic).
// Shared between host and client. Implements the agreed design:
//   - Domain relation graph is a DAG (roots + parent→child edges), allowing
//     cross/overlapping disciplines.
//   - Term entries are FLAT objects with a `domains` array and a multi-language
//     `terms` map (languages are peers — English is NOT special).
//   - Querying a domain resolves its ancestor closure; terms whose `domains`
//     intersect that closure match (children inherit parent terminology).
//   - Same word with different meanings in different domains = SEPARATE entries
//     (e.g. cell: biology=细胞 vs CV=单元), so a locked domain+lang yields a
//     unique translation. A duplicate hit is reported as a WARNING (dev helper).

export type TermSource = 'llm' | 'user' | 'seed';

export interface TermEntry {
  /** Stable id. */
  id: string;
  /** Domains this term applies to (intersects the resolved ancestor closure). Empty = universal fallback. */
  domains: string[];
  /** Multi-language surface forms — languages are peers (no default). */
  terms: Record<string, string>;
  /** Confidence 0..1. Low-confidence entries are not auto-promoted. */
  confidence: number;
  /** Whether a user confirmed it (guards against self-strengthening errors). */
  confirmedByUser: boolean;
  /** Where it came from. */
  source: TermSource;
  /** First-seen epoch ms. */
  firstSeen: number;
}

export interface DomainGraph {
  /** Top-level roots. */
  roots: string[];
  /** parent → children edges (a node may appear under several parents; DAG). */
  edges: Record<string, string[]>;
}

/** A term hit returned by a query. */
export interface TermHit {
  entry: TermEntry;
  /** The surface form that matched (language key). */
  lang: string;
  /** The matched source-language form. */
  source: string;
  /** The target-language translation (terms[targetLang] or fallback). */
  target?: string;
  /** Whether this entry belongs DIRECTLY to the query domain (vs an ancestor). */
  directlyInDomain: boolean;
}

/** Result of a term query, including any duplicate/conflict warnings. */
export interface TermQueryResult {
  hits: TermHit[];
  /** Warnings surfaced during a dev-stage query (conflicts, ambiguity). */
  warnings: string[];
  /** The resolved ancestor closure that was searched. */
  closure: string[];
}

// ── DAG: ancestor closure ─────────────────────────────────────────────────
// Reverse edge map: child → parents.
function reverseEdges(g: DomainGraph): Record<string, string[]> {
  const rev: Record<string, string[]> = {};
  for (const parent of Object.keys(g.edges)) {
    for (const child of g.edges[parent]) {
      (rev[child] = rev[child] || []).push(parent);
    }
  }
  return rev;
}

/**
 * All ancestors of `domain` including itself (the closure searched for terms).
 * BFS up the reverse edges, deduped with a visited set. Cycle-safe: an edge
 * that would revisit a node is ignored, so a malformed graph never hangs.
 */
export function ancestorClosure(domain: string, g: DomainGraph): string[] {
  const rev = reverseEdges(g);
  const visited = new Set<string>();
  const queue = [domain];
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const parent of rev[cur] ?? []) {
      if (!visited.has(parent)) queue.push(parent);
    }
  }
  return [...visited];
}

/** Detect a cycle in the graph (a node reachable from itself). Returns true if cyclic. */
export function hasCycle(g: DomainGraph): boolean {
  // DFS 3-color over the whole graph. Returning true = a back edge found.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const nodes = new Set<string>(g.roots);
  for (const p of Object.keys(g.edges)) { nodes.add(p); for (const c of g.edges[p]) nodes.add(c); }
  const dfs = (n: string): boolean => {
    color[n] = GRAY;
    for (const child of g.edges[n] ?? []) {
      if (color[child] === GRAY) return true;
      if (color[child] === undefined && dfs(child)) return true;
    }
    color[n] = BLACK;
    return false;
  };
  for (const n of nodes) if (color[n] === undefined && dfs(n)) return true;
  return false;
}

// ── Query ─────────────────────────────────────────────────────────────────
/**
 * Query terms for a (domain, sourceLang, targetLang) context.
 * @param domain  the target domain
 * @param sourceLang  the source language key to match surface forms against
 * @param text  the selection text to match (substring; exact match preferred)
 * @param graph  domain graph
 * @param entries  the full glossary
 * @param targetLang  optional target language for the translation field
 */
export function queryTerms(
  domain: string,
  sourceLang: string,
  text: string | undefined,
  graph: DomainGraph,
  entries: TermEntry[],
  targetLang?: string,
): TermQueryResult {
  const closure = ancestorClosure(domain, graph);
  const closureSet = new Set(closure);
  const warnings: string[] = [];
  const norm = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const needle = norm(text ?? '');

  const hits: TermHit[] = [];
  for (const entry of entries) {
    // domain filter: entry applies if entry.domains is empty (universal) OR
    // intersects the closure. It is "directly in domain" if it names `domain`.
    const intersects = entry.domains.length === 0 || entry.domains.some((d) => closureSet.has(d));
    if (!intersects) continue;
    // language filter: match the surface form in sourceLang.
    const form = entry.terms[sourceLang];
    if (form === undefined) continue;
    const formNorm = norm(form);
    const matched = needle
      ? (needle.includes(formNorm) || formNorm.includes(needle))
      : true;
    if (needle && !matched) continue;
    hits.push({
      entry,
      lang: sourceLang,
      source: form,
      target: targetLang ? entry.terms[targetLang] : undefined,
      directlyInDomain: entry.domains.includes(domain),
    });
  }

  // Dev-stage resolution policy (temporary, for a clean unique answer):
  // if any hit names the QUERY domain directly, prefer ONLY those — a child
  // discipline's own terminology wins over ancestors, so e.g. biology's "cell"
  // does not leak into computer-vision when CV also defines its own "cell".
  // This keeps "locked domain → unique translation" reliable. Ancestor
  // inheritance still applies when the domain has NO direct terms (and only
  // universal fallback terms carry it). TODO: revisit as a configurable policy.
  const direct = hits.filter((h) => h.directlyInDomain);
  const effective = direct.length > 0 ? direct : hits;
  if (direct.length > 0 && hits.length > direct.length) {
    warnings.push(`领域「${domain}」直接命中 ${direct.length} 条，已忽略 ${hits.length - direct.length} 条祖先继承项（dev 优先策略）。`);
  }

  // Dev-stage conflict warning: same (domain-closure, lang, source form) with
  // DIFFERENT target translations → ambiguous. Report for developer triage.
  const byKey = new Map<string, TermHit[]>();
  for (const h of effective) {
    const key = `${h.lang}\u0000${h.source.toLowerCase()}`;
    const arr = byKey.get(key);
    if (arr) arr.push(h); else byKey.set(key, [h]);
  }
  for (const [key, group] of byKey) {
    const targets = new Set(group.filter((h) => h.target).map((h) => h.target!));
    if (targets.size > 1) {
      const langs = group.map((h) => h.entry.terms[h.lang]).join(' / ');
      warnings.push(`术语冲突：同一语言「${langs}」在领域「${domain}」下命中多个译法（${[...targets].join('、')}）。请核查术语表录入。dev#` + key.replace(/\u0000/g, ':'));
    }
  }

  // Return the effectively-used set (direct hits when present, else ancestors).
  return { hits: effective, warnings, closure };
}
