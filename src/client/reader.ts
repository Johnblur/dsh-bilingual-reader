// src/client/reader.ts — PDF 阅读 + 划词翻译: 上方 PDF(原生显示, 完美), 下方译文条.
// Read from the native PDF viewer by copying a selection; we read the OS clipboard,
// match it against the extracted text (background only) to recover context, then translate.
import type { DocumentText, TranslateRequest } from '../types.js';
import { makePdfView } from './PdfView.js';

export interface ReaderController {
  loadDocument: (file: string) => Promise<{ text: DocumentText; chunks: unknown[]; glossary: Record<string, string> }>;
  translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: unknown) => void) => Promise<string>;
}

interface ReactPieces {
  h: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
  useCallback: <T>(fn: T, deps: any[]) => T;
}

export function makeReader({ h, useState, useEffect, useCallback }: ReactPieces) {
  const PdfView = makePdfView({ h, useState, useEffect });
  return function BilingualReader(props: { file?: string; controller?: ReaderController }): any {
    const { file = '', controller } = props as { file?: string; controller?: ReaderController };
    const [doc, setDoc] = useState(null);
    const [glossary, setGloss] = useState({});
    const [sel, setSel] = useState(null);
    const [selResult, setSelResult] = useState('');
    const [topPct, setTopPct] = useState(52);
    const [contextLen, setContextLen] = useState(250);

    const load = useCallback(async () => {
      if (!controller || !file) return;
      const { text, glossary } = await controller.loadDocument(file);
      setDoc(text); setGloss(glossary);
    }, [controller, file]);

    useEffect(() => { void load(); }, [load]);

    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

    async function doTranslate(copied: string): Promise<void> {
      if (!copied) { setSelResult('（剪贴板为空：请先在 PDF 里选中并复制）'); return; }
      if (!doc) { setSelResult('（文档未加载）'); return; }
      const selText = normalize(copied).slice(0, 1500);
      const normDoc = normalize(doc.fullText);
      let context = '';
      const hits: number[] = [];
      let i = normDoc.indexOf(selText);
      while (i >= 0) { hits.push(i); i = normDoc.indexOf(selText, i + 1); }
      if (hits.length === 1) {
        const idx = hits[0];
        context = normDoc.slice(Math.max(0, idx - contextLen), idx + selText.length + contextLen);
      }
      setSel({ selection: selText, context });
      setSelResult('');
      if (!controller) return;
      const res = await controller.translateSelection(
        { kind: 'selection', selection: selText, context, glossary, target: '中文' },
        new AbortController().signal, () => {},
      );
      setSelResult(res);
    }

    async function onClipboardTranslate(): Promise<void> {
      try {
        await doTranslate(await navigator.clipboard.readText());
      } catch (err) {
        setSelResult('读取剪贴板失败：' + (err instanceof Error ? err.message : String(err)));
      }
    }

    // Electron-only: poll the host clipboard route; when the system clipboard changes,
    // auto-translate. Falls back to the button on web.
    useEffect(() => {
      let last = '';
      const poll = async () => {
        try {
          const r = await fetch('/bilingual-reader/clipboard');
          const j = await r.json();
          const text = j && typeof j.text === 'string' ? j.text : '';
          if (text && text !== last) { last = text; await doTranslate(text); }
          else if (!text) last = '';
        } catch { /* ignore */ }
      };
      const id = setInterval(poll, 400);
      return () => clearInterval(id);
    }, [doc, glossary, controller, contextLen]);

    function onDividerDown(e: any): void {
      e.preventDefault();
      const container = e.currentTarget.parentElement;
      const rect = container.getBoundingClientRect();
      const div = e.currentTarget;
      document.body.style.userSelect = 'none';
      const startY = e.clientY;
      const startPct = topPct;
      const mm = (ev: any) => { ev.preventDefault(); setTopPct(Math.max(8, Math.min(92, startPct + ((ev.clientY - startY) / rect.height) * 100))); };
      const done = () => {
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', mm);
        window.removeEventListener('mouseup', done);
        try { div.releasePointerCapture(e.pointerId); } catch {}
        div.removeEventListener('pointermove', mm);
        div.removeEventListener('pointerup', done);
      };
      window.addEventListener('mousemove', mm);
      window.addEventListener('mouseup', done);
      try { div.setPointerCapture(e.pointerId); } catch {}
      div.addEventListener('pointermove', mm);
      div.addEventListener('pointerup', done);
    }

    const top = h('div', { style: { height: `${topPct}%`, overflow: 'auto', padding: 8 } },
      h(PdfView, { file }),
    );

    const divider = h('div', { onPointerDown: onDividerDown, style: { height: 8, cursor: 'row-resize', background: '#e2e8f0', flex: 'none', userSelect: 'none', touchAction: 'none' } });

    const bottom = h('div', { style: { flex: 1, overflow: 'auto', padding: 12, borderTop: '1px solid #e2e8f0' } },
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
        h('button', { onClick: () => void onClipboardTranslate() }, '翻译选中（在 PDF 里复制后）'),
        h('label', undefined, '上下文'),
        h('input', { type: 'range', min: 0, max: 800, step: 50, value: contextLen, onChange: (e: any) => setContextLen(Number(e.target.value)), style: { width: 160 } }),
        h('span', undefined, contextLen + ' 字'),
      ),
      h('div', { style: { marginTop: 10 } },
        sel
          ? h('div', {},
              h('div', { style: { color: '#718096', fontSize: 13, marginBottom: 6, maxHeight: 130, overflow: 'auto' } }, '原文：' + sel.selection),
              h('div', { style: { lineHeight: 1.7 } }, selResult || '翻译中…'),
            )
          : h('p', { style: { color: '#a0aec0', marginTop: 4 } }, '在 PDF 里选中一段文字并复制，即可自动翻译（或点「翻译选中」）。'),
      ),
    );

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      top, divider, bottom,
    );
  };
}
