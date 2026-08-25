// src/client/reader.ts — PDF 阅读 + 划词翻译: 上方 PDF(原生显示, 完美), 下方译文条.
// Read from the native PDF viewer by copying a selection; we read the OS clipboard,
// match it against the extracted text (background only) to recover context, then translate.
import type { DocumentText, TranslateRequest } from '../types.js';
import { makePdfView } from './PdfView.js';

// Match DSH's native secondary-button palette (exactly what better-sidebar's own
// buttons consume): the theme package defines these `--dsw-alias-*` tokens on
// `body`, so they resolve anywhere in the host DOM, in both light and dark themes.
// Shape (borderRadius 6 / padding 4px 10px / font 13) is unchanged from the old
// "复制译文" button; only the COLORS now ride DSH's design tokens. Hover needs a
// real rule (inline style can't express :hover), so we inject one CSS block once.
function ensureButtonStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dsh-bl-btn-style')) return;
  const s = document.createElement('style');
  s.id = 'dsh-bl-btn-style';
  s.textContent =
    '.dsh-bl-btn{display:inline-flex;align-items:center;justify-content:center;' +
    'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);' +
    'color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:13px;' +
    'cursor:pointer}.dsh-bl-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}';
  document.head.appendChild(s);
}
ensureButtonStyle();

export interface ReaderController {
  loadDocument: (file: string) => Promise<{ text: DocumentText; chunks: unknown[]; glossary: Record<string, string> }>;
  translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: unknown) => void) => Promise<string>;
}

interface ReactPieces {
  h: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
  useCallback: <T>(fn: T, deps: any[]) => T;
  useRef: <T>(init: T) => { current: T };
}

export function makeReader({ h, useState, useEffect, useCallback, useRef }: ReactPieces) {
  const PdfView = makePdfView({ h, useState, useEffect });
  return function BilingualReader(props: { file?: string; controller?: ReaderController }): any {
    const { file = '', controller } = props as { file?: string; controller?: ReaderController };
    const [doc, setDoc] = useState(null);
    const [glossary, setGloss] = useState({});
    const [sel, setSel] = useState(null);
    const [selResult, setSelResult] = useState('');
    const [topPct, setTopPct] = useState(75);
    const [contextLen, setContextLen] = useState(250);
    const [clipAvailable, setClipAvailable] = useState(false);
    const [selError, setSelError] = useState(false);
    const reqSeq = useRef(0);

    const load = useCallback(async () => {
      if (!controller || !file) return;
      const { text, glossary } = await controller.loadDocument(file);
      setDoc(text); setGloss(glossary);
    }, [controller, file]);

    useEffect(() => { void load(); }, [load]);

    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

    async function doTranslate(copied: string): Promise<void> {
      const seq = ++reqSeq.current;
      if (!copied) { setSel({ selection: '', context: '' }); setSelError(true); setSelResult('（剪贴板为空：请先在 PDF 里选中并复制）'); return; }
      if (!doc) { setSelError(true); setSelResult('（文档未加载）'); return; }
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
      if (!controller) { setSelError(true); return; }
      try {
        const res = await controller.translateSelection(
          { kind: 'selection', selection: selText, context, glossary, target: '中文' },
          new AbortController().signal, () => {},
        );
        // Only apply the result if this is still the latest request (avoid stale overwrites).
        if (seq === reqSeq.current) { setSelResult(res); setSelError(false); }
      } catch (err) {
        if (seq === reqSeq.current) { setSelResult('翻译失败：' + (err instanceof Error ? err.message : String(err))); setSelError(true); }
      }
    }

    async function onClipboardTranslate(): Promise<void> {
      try {
        await doTranslate(await navigator.clipboard.readText());
      } catch (err) {
        setSelResult('读取剪贴板失败：' + (err instanceof Error ? err.message : String(err))); setSelError(true);
      }
    }

    // Auto-translate on copy: poll the host clipboard route; when the system clipboard
    // changes (Electron can read it), translate immediately. Button remains as a reliable
    // fallback (web / if polling is unavailable).
    useEffect(() => {
      let last = '';
      const poll = async () => {
        try {
          const r = await fetch('/bilingual-reader/clipboard');
          const j = await r.json();
          setClipAvailable(!!j.available);
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

    const top = h('div', { style: { height: `${topPct}%`, overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
      h(PdfView, { file }),
    );

    const divider = h('div', { onPointerDown: onDividerDown, style: { height: 8, cursor: 'row-resize', background: '#e2e2e2', flex: 'none', userSelect: 'none', touchAction: 'none' } });

    const bottom = h('div', { style: { flex: 1, overflow: 'auto', padding: 12, borderTop: '1px solid #e2e2e2', color: '#1f2329' } },
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', color: '#555' } },
        clipAvailable
          ? h('span', { style: { fontSize: 13 } }, '✓ 已启用自动翻译')
          : h('button', { onClick: () => void onClipboardTranslate(), className: 'dsh-bl-btn' }, '翻译选中'),
        h('label', { style: { fontSize: 13, color: '#555' } }, '上下文'),
        h('input', { type: 'range', min: 0, max: 800, step: 50, value: contextLen, onChange: (e: any) => setContextLen(Number(e.target.value)), style: { width: 160, accentColor: '#555' } }),
        h('span', { style: { fontSize: 13, color: '#555' } }, contextLen + ' 字'),
      ),
      h('div', { style: { marginTop: 10 } },
        sel
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              h('div', { style: { color: '#666', fontSize: 13, maxHeight: 130, overflow: 'auto' } }, '原文：' + sel.selection),
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
                h('div', { style: { flex: 1, lineHeight: 1.7, color: selError ? '#e53e3e' : '#1f2329' } }, selResult || '翻译中…'),
                selResult ? h('button', { onClick: () => void navigator.clipboard.writeText(selResult), className: 'dsh-bl-btn' }, '复制译文') : undefined,
              ),
            )
          : h('p', { style: { color: '#8a8a8a', marginTop: 4, fontSize: 13 } }, '在 PDF 里选中一段文字并复制，即可自动翻译；无法自动时点「翻译选中」。'),
      ),
    );

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
      top, divider, bottom,
    );
  };
}
