// src/index.ts — host plugin entry.
// Exposes /bilingual-reader/* HTTP routes so the client tab can extract PDF text and
// translate. Translation runs through the injected `llm` service in an ISOLATED call
// (never appends to the main conversation).
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { extractPdf } from './host/pdf.js';
import { chunkDocument } from './host/chunk.js';
import { extractGlossary } from './host/glossary.js';
import { createLlmGateway, type LlmGateway } from './host/llmClient.js';
import { translateChunk, translateSelection } from './host/translate.js';
import { resolveModel } from './host/model.js';
import type { DocChunk, TranslateRequest } from './types.js';

export const inject = ['llm', 'webServer'];

interface HttpReq { method?: string; url?: string; on: (e: 'data' | 'end' | 'error', cb: (...a: any[]) => void) => void }
interface HttpRes { writeHead: (code: number, headers?: Record<string, string>) => void; end: (body?: string | Buffer | Uint8Array) => void }

export function apply(ctx: { llm: unknown; webServer: unknown }): void {
  const gateway: LlmGateway = createLlmGateway(ctx.llm);
  const nodeRequire = createRequire(import.meta.url);
  const pdfjsDir = path.dirname(nodeRequire.resolve('pdfjs-dist/package.json'));
  const ws = ctx.webServer as { register: (r: { kind: string; path: string; handler: (req: HttpReq, res: HttpRes) => void }) => void };

  // single-document state (extract populates chunks; translate-chunk looks them up)
  let chunks: DocChunk[] = [];
  let glossary: Record<string, string> = {};

  ws.register({ kind: 'prefix', path: '/bilingual-reader', handler: async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const pathname = u.pathname;
    try {
      // Serve pdf.js CMap / standard-font data so the client's text layer can render
      // CJK + non-embedded fonts correctly (otherwise it falls back to a wrong font,
      // causing the text layer to misalign).
      if ((pathname.startsWith('/bilingual-reader/cmaps/') || pathname.startsWith('/bilingual-reader/standard_fonts/')) && req.method === 'GET') {
        const sub = pathname.startsWith('/bilingual-reader/cmaps/')
          ? path.join(pdfjsDir, 'cmaps', path.basename(pathname))
          : path.join(pdfjsDir, 'standard_fonts', path.basename(pathname));
        try {
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-cache' });
          res.end(await fs.readFile(sub));
        } catch { res.writeHead(404); res.end(); }
        return;
      }
      // Serve the original PDF so the client can embed it as the "原文".
      if (pathname === '/bilingual-reader/file' && req.method === 'GET') {
        const file = decodeURIComponent(u.searchParams.get('path') || '');
        const data = await fs.readFile(file);
        res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-cache' });
        res.end(data);
        return;
      }
      // Read the OS clipboard (Electron only; falls back to empty on web). Lets us
      // auto-translate as soon as the user copies a selection from the native PDF viewer.
      if (pathname === '/bilingual-reader/clipboard' && req.method === 'GET') {
        let text = ''; let available = false;
        try {
          const electron = nodeRequire('electron') as any;
          available = !!electron?.clipboard;
          text = (electron?.clipboard?.readText?.() ?? '');
        } catch { available = false; text = ''; }
        return json(res, 200, { text, available });
      }
      // Serve pdf.js's browser build + worker so the client can import them at runtime
      // (avoids bundling pdf.js into the __ModuleLoader__ client, and no native canvas).
      if (pathname === '/bilingual-reader/pdf.mjs' && req.method === 'GET') {
        const p = nodeRequire.resolve('pdfjs-dist/build/pdf.mjs');
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(await fs.readFile(p));
        return;
      }
      if (pathname === '/bilingual-reader/pdf.worker.mjs' && req.method === 'GET') {
        const p = nodeRequire.resolve('pdfjs-dist/build/pdf.worker.mjs');
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(await fs.readFile(p));
        return;
      }
      const body = await readJson(req);
      // List .pdf files under a workdir (recursively, bounded) so the loader tab can
      // offer a "browse" picker — no manual copy/paste of a full path. Self-contained
      // (Node fs), so the plugin stays independent of better-sidebar's internal API.
      if (pathname === '/bilingual-reader/list-pdfs' && req.method === 'POST') {
        const root = String(body?.dir ?? '');
        const limit = Math.max(1, Math.min(500, Number(body?.limit ?? 200) || 200));
        const depth = Math.max(0, Math.min(10, Number(body?.depth ?? 3) || 3));
        const files = await listPdfs(root, limit, depth);
        return json(res, 200, { dir: root, files });
      }
      if (pathname === '/bilingual-reader/extract' && req.method === 'POST') {
        const file = String(body?.path ?? '');
        const text = await extractPdf(file);
        chunks = chunkDocument(text);
        glossary = extractGlossary(chunks);
        return json(res, 200, { text, chunks, glossary });
      }
      if (pathname === '/bilingual-reader/translate-chunk' && req.method === 'POST') {
        const chunkId = String(body?.chunkId ?? '');
        const chunk = chunks.find((c) => c.id === chunkId);
        if (!chunk) return json(res, 404, { error: 'chunk not found: ' + chunkId });
        const out = await translateChunk(gateway, chunk, { kind: 'full-text', glossary, target: '中文' }, new AbortController().signal, () => {}, chunkId);
        return json(res, 200, { requestId: chunkId, text: out });
      }
      if (pathname === '/bilingual-reader/translate-selection' && req.method === 'POST') {
        const reqBody = body as unknown as TranslateRequest & { selection?: string; context?: string };
        const requestId = `sel-${Date.now()}`;
        const out = await translateSelection(gateway, reqBody.selection ?? '', reqBody.context ?? '', { ...reqBody, kind: 'selection', glossary }, new AbortController().signal, () => {}, requestId);
        return json(res, 200, { requestId, text: out });
      }
      return json(res, 404, { error: 'unknown route ' + pathname });
    } catch (e) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  } });
}

function readJson(req: HttpReq): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : undefined); }
      catch (e) { reject(e); }
    });
    req.on('error', (e) => reject(e));
  });
}

function json(res: HttpRes, code: number, payload: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

// Recursively collect .pdf files under `dir` (bounded by count + depth so a huge
// or deeply nested workspace never hangs the request). Skips hidden dirs and
// node_modules. Returns paths sorted with newest first (most recent PDF on top).
async function listPdfs(dir: string, limit: number, depth: number): Promise<{ path: string; name: string }[]> {
  const out: { path: string; name: string; mtime: number }[] = [];
  const seen = new Set<string>();
  const skip = new Set(['node_modules', '.git', '.dsh', 'dist', 'build', '.pnpm-store', '.npm-cache']);
  const walk = async (d: string, level: number): Promise<void> => {
    if (out.length >= limit || level > depth) return;
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      const full = path.join(d, e.name);
      if (!seen.has(full)) seen.add(full);
      if (e.isDirectory()) {
        if (e.name.startsWith('.') || skip.has(e.name)) continue;
        await walk(full, level + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
        try {
          const st = await fs.stat(full);
          out.push({ path: full, name: e.name, mtime: st.mtimeMs });
        } catch { /* ignore unreadable */ }
      }
    }
  };
  await walk(dir, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit).map(({ path, name }) => ({ path, name }));
}
