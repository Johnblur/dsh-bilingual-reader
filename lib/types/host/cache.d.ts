import type { DocChunk } from '../types.js';
export interface CacheEntry {
    hash: string;
    text: string;
    model?: string;
    glossary?: string;
}
export declare function hashText(text: string): string;
export declare function loadCache(file: string): Promise<Record<string, CacheEntry>>;
export declare function saveCache(file: string, entries: Record<string, CacheEntry>): Promise<void>;
export declare function entriesFromChunks(chunks: DocChunk[], cache: Record<string, CacheEntry>): Record<string, CacheEntry>;
