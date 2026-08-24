// src/client/reader.ts — bilingual reader + translation pane as a hyperscript factory.
// React pieces (h/useState/useEffect) are injected by the client factory, so this
// module has NO top-level `import ... from 'react'` — required by DSH's client
// bundle (classic script; react comes from the __ModuleLoader__ factory's require).
//
// Injected React pieces are typed `any` on purpose: this is client render glue, and
// DSH-provided React's precise generic types create more friction than they resolve.
import type { DocChunk, DocumentText, TranslateEvent, TranslateRequest } from '../types.js';
import { buildSelectionContext } from './context.js';

export interface ReaderController {
  loadDocument: (file: string) => Promise<{ text: DocumentText; chunks: DocChunk[]; glossary: Record<string, string> }>;
  translateChunk: (chunkId: string, glossary: Record<string, string>, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
  translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
}

interface ReactPieces {
  h: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
  useCallback: <T>(fn: T, deps: any[]) => T;
}

export function makeReader({ h, useState, useEffect, useCallback }: ReactPieces) {
  return function BilingualReader(props: { file?: string; controller?: ReaderController }): any {
    const { file = '', controller } = props as { file?: string; controller?: ReaderController };
    const [chunks, setChunks] = useState([]);
    const [doc, setDoc] = useState(null);
    const [glossary, setGloss] = useState({});
    const [mode, setMode] = useState('both');
    const [tr, setTr] = useState({});
    const [busy, setBusy] = useState({});
    const [sel, setSel] = useState(null);
    const [selResult, setSelResult] = useState('');

    const push = useCallback((e: TranslateEvent) => {
      if (e.type === 'delta') setTr((s: Record<string, string>) => ({ ...s, [e.requestId]: (s[e.requestId] ?? '') + e.text }));
      else if (e.type === 'done') setTr((s: Record<string, string>) => ({ ...s, [e.requestId]: e.full }));
      else if (e.type === 'error') setTr((s: Record<string, string>) => ({ ...s, [e.requestId]: `[error] ${e.message}` }));
    }, []);

    const load = useCallback(async () => {
      if (!controller || !file) return;
      const { text, chunks, glossary } = await controller.loadDocument(file);
      setDoc(text); setChunks(chunks); setGloss(glossary);
      if (chunks[0]) {
        setBusy((b: Record<string, boolean>) => ({ ...b, [chunks[0].id]: true }));
        await controller.translateChunk(chunks[0].id, glossary, new AbortController().signal, (e) => {
          push(e);
          if (e.type === 'done' || e.type === 'error') setBusy((b: Record<string, boolean>) => ({ ...b, [chunks[0].id]: false }));
        });
      }
    }, [controller, file, push]);

    useEffect(() => { void load(); }, [load]);

    async function onSelect(text: string): Promise<void> {
      if (!text || !doc) return;
      const ctx = buildSelectionContext(text, doc.fullText);
      setSel(ctx); setSelResult('');
      if (!controller) return;
      const res = await controller.translateSelection(
        { kind: 'selection', selection: ctx.selection, context: ctx.context, glossary, target: '中文' },
        new AbortController().signal,
        push,
      );
      setSelResult(res);
    }

    const modeButtons = (['original', 'both', 'translation'] as const).map((m) =>
      h('button', { key: m, onClick: () => setMode(m), style: { marginLeft: 4 } }, m),
    );

    const sections = chunks.map((c: DocChunk) =>
      h('section', { key: c.id, style: { marginBottom: 8 } },
        c.heading ? h('h3', { style: { fontWeight: 600 } }, c.heading) : undefined,
        mode !== 'translation'
          ? h('div', { onMouseUp: (e: unknown) => { const s = window.getSelection(); const t = s ? String(s) : ''; if (t.trim()) void onSelect(t.trim()); } },
              (c.text || '').split(/\n{2,}/).map((p, i) => h('p', { key: i, style: { lineHeight: 1.6 } }, p)))
          : undefined,
        mode !== 'original'
          ? h('div', { style: { color: '#2b6cb0' } }, tr[c.id] || (busy[c.id] ? '翻译中…' : '—'))
          : undefined,
      ),
    );

    const pane = h('aside', { style: { width: 360, borderLeft: '1px solid #e2e8f0', padding: 12 } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        h('strong', undefined, '划词翻译'),
        h('button', { disabled: !selResult, onClick: () => { if (selResult) void navigator.clipboard.writeText(selResult); } }, '复制译文'),
      ),
      sel
        ? h('p', { style: { color: '#718096', marginTop: 8 } }, '译文（已用上下文理解词义）：')
        : h('p', { style: { color: '#a0aec0', marginTop: 8 } }, '选中文字后，译文会显示在这里。'),
      h('div', { style: { marginTop: 8, lineHeight: 1.7 } }, selResult || ''),
    );

    return h('div', { style: { display: 'flex', height: '100%' } },
      h('div', { style: { flex: 1, overflow: 'auto' } },
        h('div', { style: { padding: 8 } }, h('span', undefined, '显示：'), ...modeButtons),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 } }, ...sections),
      ),
      pane,
    );
  };
}
