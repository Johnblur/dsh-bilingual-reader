// src/client/reader.ts — bilingual reader: 上方原文 / 下方译文, 中间可拖动分割线.
// React pieces injected by the client factory (classic-script bundle, react via factory require).
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
    const [tr, setTr] = useState({});
    const [busy, setBusy] = useState({});
    const [sel, setSel] = useState(null);
    const [selResult, setSelResult] = useState('');
    const [topPct, setTopPct] = useState(45);

    const push = useCallback((e: TranslateEvent) => {
      if (e.type === 'delta') setTr((s: Record<string, string>) => ({ ...s, [e.requestId]: (s[e.requestId] ?? '') + e.text }));
      else if (e.type === 'done') setTr((s: Record<string, string>) => ({ ...s, [e.requestId]: e.full }));
      else if (e.type === 'error') setTr((s: Record<string, string>) => ({ ...s, [e.requestId]: `[error] ${e.message}` }));
    }, []);

    const load = useCallback(async () => {
      if (!controller || !file) return;
      const { text, chunks, glossary } = await controller.loadDocument(file);
      setDoc(text); setChunks(chunks); setGloss(glossary);
    }, [controller, file]);

    useEffect(() => { void load(); }, [load]);

    async function translateAll(): Promise<void> {
      if (!controller) return;
      for (const c of chunks) {
        if (tr[c.id]) continue;
        setBusy((b: Record<string, boolean>) => ({ ...b, [c.id]: true }));
        try {
          await controller.translateChunk(c.id, glossary, new AbortController().signal, (e) => {
            push(e);
            if (e.type === 'done' || e.type === 'error') setBusy((b: Record<string, boolean>) => ({ ...b, [c.id]: false }));
          });
        } catch (err) {
          push({ type: 'error', requestId: c.id, message: err instanceof Error ? err.message : String(err) });
          setBusy((b: Record<string, boolean>) => ({ ...b, [c.id]: false }));
        }
      }
    }

    async function onSelect(text: string): Promise<void> {
      if (!text || !doc) return;
      const ctx = buildSelectionContext(text, doc.fullText);
      setSel(ctx); setSelResult('');
      if (!controller) return;
      try {
        const res = await controller.translateSelection(
          { kind: 'selection', selection: ctx.selection, context: ctx.context, glossary, target: '中文' },
          new AbortController().signal, push,
        );
        setSelResult(res);
      } catch (err) {
        setSelResult(err instanceof Error ? err.message : String(err));
      }
    }

    function onDividerDown(e: any): void {
      const container = e.currentTarget.parentElement;
      const rect = container.getBoundingClientRect();
      const mm = (ev: any) => { setTopPct(Math.max(8, Math.min(92, ((ev.clientY - rect.top) / rect.height) * 100))); };
      const mu = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', mu);
    }

    const originalPane = h('div', { style: { height: `${topPct}%`, overflow: 'auto', padding: 16 } },
      h('div', { style: { position: 'sticky', top: 0, paddingBottom: 8, background: '#fff' } },
        h('button', { onClick: () => void translateAll(), disabled: !chunks.length }, '翻译全文'),
      ),
      chunks.map((c: DocChunk) =>
        h('section', { key: c.id, style: { marginBottom: 10 } },
          c.heading ? h('h3', { style: { fontWeight: 600 } }, c.heading) : undefined,
          h('div', { onMouseUp: (e: any) => { const s = window.getSelection(); const t = s ? String(s) : ''; if (t.trim()) void onSelect(t.trim()); } },
            (c.text || '').split(/\n{2,}/).map((p: string, i: number) => h('p', { key: i, style: { lineHeight: 1.6 } }, p))),
        ),
      ),
    );

    const divider = h('div', { onMouseDown: onDividerDown, style: { height: 8, cursor: 'row-resize', background: '#e2e8f0', flex: 'none' } });

    const translationPane = h('div', { style: { flex: 1, overflow: 'auto', padding: 16, borderTop: '1px solid #e2e8f0' } },
      sel
        ? h('div', {},
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('strong', undefined, '译文'),
              h('button', { disabled: !selResult, onClick: () => { if (selResult) void navigator.clipboard.writeText(selResult); } }, '复制译文'),
            ),
            h('div', { style: { marginTop: 6, lineHeight: 1.7 } }, selResult || '翻译中…'),
          )
        : h('div', {},
            h('strong', undefined, '译文'),
            chunks.filter((c: DocChunk) => tr[c.id]).length
              ? chunks.filter((c: DocChunk) => tr[c.id]).map((c: DocChunk) =>
                  h('div', { key: c.id, style: { marginBottom: 8 } },
                    c.heading ? h('small', { style: { color: '#718096' } }, c.heading) : undefined,
                    h('p', { style: { lineHeight: 1.7 } }, tr[c.id])),
                )
              : h('p', { style: { color: '#a0aec0' } }, '点「翻译全文」或选中原文里的词，译到这里。'),
          ),
    );

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      originalPane, divider, translationPane,
    );
  };
}
