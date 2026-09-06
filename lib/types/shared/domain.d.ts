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
/**
 * All ancestors of `domain` including itself (the closure searched for terms).
 * BFS up the reverse edges, deduped with a visited set. Cycle-safe: an edge
 * that would revisit a node is ignored, so a malformed graph never hangs.
 */
export declare function ancestorClosure(domain: string, g: DomainGraph): string[];
/** Detect a cycle in the graph (a node reachable from itself). Returns true if cyclic. */
export declare function hasCycle(g: DomainGraph): boolean;
/**
 * Query terms for a (domain, sourceLang, targetLang) context.
 * @param domain  the target domain
 * @param sourceLang  the source language key to match surface forms against
 * @param text  the selection text to match (substring; exact match preferred)
 * @param graph  domain graph
 * @param entries  the full glossary
 * @param targetLang  optional target language for the translation field
 */
export declare function queryTerms(domain: string, sourceLang: string, text: string | undefined, graph: DomainGraph, entries: TermEntry[], targetLang?: string): TermQueryResult;
