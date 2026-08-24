// host/cache.ts — per-document translation cache (.zh sidecar), keyed by source hash.
// Pure-ish: reads/writes JSON sidecars. On hash match, skips re-translation (incremental).
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { DocChunk } from '../types.js';

export interface CacheEntry {
  hash: string;      // sha256 of the source text
  text: string;      // translated result
  model?: string;
  glossary?: string;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sidecarPath(file: string): string {
  const base = path.basename(file, path.extname(file));
  return path.join(path.dirname(file), `${base}.zh.json`);
}

export async function loadCache(file: string): Promise<Record<string, CacheEntry>> {
  try {
    const raw = await fs.readFile(sidecarPath(file), 'utf8');
    return JSON.parse(raw) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

export async function saveCache(file: string, entries: Record<string, CacheEntry>): Promise<void> {
  await fs.writeFile(sidecarPath(file), JSON.stringify(entries, null, 2), 'utf8');
}

export function entriesFromChunks(chunks: DocChunk[], cache: Record<string, CacheEntry>): Record<string, CacheEntry> {
  for (const c of chunks) {
    const hash = hashText(c.text);
    if (cache[c.id] && cache[c.id].hash === hash) continue; // unchanged -> keep
    cache[c.id] = { hash, text: '', model: '', glossary: '' };
  }
  return cache;
}
