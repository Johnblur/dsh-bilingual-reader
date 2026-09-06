// src/client/reader.ts — PDF 阅读 + 划词翻译: 上方 PDF(原生显示, 完美), 下方译文条.
// Read from the native PDF viewer by copying a selection; we read the OS clipboard,
// match it against the extracted text (background only) to recover context, then translate.
import type { DocumentText, TranslateRequest } from '../types.js';
import { makePdfView } from './PdfView.js';
import { BTN_CLS, inputBase } from './styles.js';
import { matchLetters, normalizeForMatch, contextRange } from './match.js';
import {
  AUTO_DETECT, allLangs, detectByScript, needsLlmDetect,
  defaultSource, defaultTarget,
  initialCustom, initialSource, initialTarget, initialContextLen,
  resolveLangCode, langName,
  loadLangBlob, saveLangBlob,
  LS_CONTEXT_LEN, LS_CUSTOM, LS_SOURCE, LS_TARGET,
  type Lang,
} from './lang.js';

export interface ReaderController {
  loadDocument: (file: string) => Promise<{ text: DocumentText; chunks: unknown[]; glossary: Record<string, string> }>;
  translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: unknown) => void) => Promise<string>;
  /** Classify a snippet's language (may be a no-op when the LLM path is unused). */
  detectLanguage?: (text: string) => Promise<string>;
  /** Classify a snippet's field/domain (shown when the domain is unspecified). */
  detectDomain?: (text: string) => Promise<string>;
  /** Query domain terms for injection + dev warnings. */
  queryTerms?: (req: { domain: string; sourceLang: string; targetLang?: string; text?: string }) => Promise<{ hits: any[]; warnings: string[] }>;
}

interface ReactPieces {
  h: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
  useCallback: <T>(fn: T, deps: any[]) => T;
  useRef: <T>(init: T) => { current: T };
}

/** Whether the DSH UI is in Chinese (best-effort; used only for the initial
 *  default target language before any user preference is loaded). */
function isZhUI(): boolean {
  try {
    const active = (window as any).__DSH_LOCALE__ ?? (navigator.language ?? '');
    return String(active).toLowerCase().startsWith('zh');
  } catch {
    return (typeof navigator !== 'undefined' ? navigator.language : '').toLowerCase().startsWith('zh');
  }
}

export function makeReader({ h, useState, useEffect, useCallback, useRef }: ReactPieces) {
  const PdfView = makePdfView({ h, useState, useEffect });
  return function BilingualReader(props: { file?: string; controller?: ReaderController }): any {
    const { file = '', controller } = props as { file?: string; controller?: ReaderController };
    const [doc, setDoc] = useState(null);
    const [glossary, setGloss] = useState({});
    const [sel, setSel] = useState(null);
    const [selResult, setSelResult] = useState('');
    // How well the copied text matched the document for context recovery.
    // `matched` = context used (unique or best-of-many); `multiple` = several
    // plausible windows, best one used; `not-found` = no match; `empty` = blank.
    const [matchSel, setMatchSel] = useState({ kind: 'empty' } as { kind: 'matched' | 'multiple' | 'not-found' | 'empty'; count?: number; score?: number });
    const [topPct, setTopPct] = useState(75);
    const [contextLen, setContextLen] = useState(initialContextLen());
    const [clipAvailable, setClipAvailable] = useState(false);
    const [selError, setSelError] = useState(false);
    // Multi-language: persisted selection + user-added languages.
    const [customLangs, setCustomLangs] = useState(initialCustom() as any);
    const [source, setSource] = useState(initialSource());
    const [target, setTarget] = useState(initialTarget(isZhUI()));
    const [detected, setDetected] = useState('');
    // LLM-detected domain (shown when the user leaves the domain unspecified).
    const [detectedDomain, setDetectedDomain] = useState('');
    // Domain (for term injection + context-free fallback). Persisted per session.
    const [domain, setDomain] = useState(loadLangBlob('dsh-bl.domain', ''));
    const [termWarnings, setTermWarnings] = useState([]);
    const reqSeq = useRef(0);
    // The auto-translate poll effect captures `doTranslate` from its own render
    // (old closure). Instead of adding source/target to that effect's deps (which
    // would reset the interval on every change), keep the CURRENT values in refs
    // and have doTranslate read them — so both the poll and the manual button
    // always use the latest language selection.
    const sourceRef = useRef(source);
    const targetRef = useRef(target);
    const customLangsRef = useRef(customLangs);
    const domainRef = useRef(domain);
    const docDomainRef = useRef('');
    sourceRef.current = source;
    targetRef.current = target;
    customLangsRef.current = customLangs;
    domainRef.current = domain;

    const load = useCallback(async () => {
      if (!controller || !file) return;
      const { text, glossary } = await controller.loadDocument(file);
      setDoc(text); setGloss(glossary);
      // Domain detection runs ONCE per document, on the whole extracted text —
      // not on a short selection (which would misjudge the field). Result is
      // stored in a ref so the translate path can use it; the UI shows it when
      // the user left the domain dropdown unspecified.
      const full = text?.fullText ?? '';
      if (full && controller.detectDomain) {
        try {
          const d = await controller.detectDomain(full.slice(0, 8000));
          const slug = (d || '').toLowerCase();
          setDetectedDomain(slug);
          docDomainRef.current = slug;
        } catch { setDetectedDomain(''); docDomainRef.current = ''; }
      } else {
        setDetectedDomain(''); docDomainRef.current = '';
      }
    }, [controller, file]);

    useEffect(() => { void load(); }, [load]);

    // Persist language settings + context length so they survive a reopen.
    useEffect(() => { saveLangBlob(LS_SOURCE, source); }, [source]);
    useEffect(() => { saveLangBlob(LS_TARGET, target); }, [target]);
    useEffect(() => { saveLangBlob(LS_CONTEXT_LEN, contextLen); }, [contextLen]);
    useEffect(() => { saveLangBlob(LS_CUSTOM, customLangs); }, [customLangs]);
    useEffect(() => { saveLangBlob('dsh-bl.domain', domain); }, [domain]);

    // Re-translate the current selection when the source/target language changes.
    // Skip the initial mount (so we don't duplicate the clipboard-triggered
    // translate); only act when a selection is already on screen.
    const mountedRef = useRef(false);
    const lastLangKeyRef = useRef('');
    useEffect(() => {
      const key = `${source}\u0000${target}`;
      if (!mountedRef.current) { mountedRef.current = true; lastLangKeyRef.current = key; return; }
      const selNow = sel as { selection?: string } | null;
      if (selNow?.selection && key !== lastLangKeyRef.current) {
        lastLangKeyRef.current = key;
        void doTranslate(selNow.selection);
      }
    }, [source, target]);

    async function doTranslate(copied: string): Promise<void> {
      const seq = ++reqSeq.current;
      if (!copied) { setSel({ selection: '', context: '' }); setSelError(true); setSelResult('（剪贴板为空：请先在 PDF 里选中并复制）'); return; }
      if (!doc) { setSelError(true); setSelResult('（文档未加载）'); return; }
      const selText = normalizeForMatch(copied).slice(0, 1500);
      let context = '';
      if (!selText) {
        setMatchSel({ kind: 'empty' });
      } else {
        // Match by letter sequence only (punctuation/whitespace/case-insensitive),
        // so a long sentence matches once, not at every sliding window.
        const m = matchLetters(doc.fullText, copied);
        if (m) {
          const { from, to } = contextRange(m.start, m.end, contextLen);
          context = doc.fullText.slice(from, to);
          setMatchSel(m.count > 1 ? { kind: 'multiple', count: m.count } : { kind: 'matched', count: 1 });
        } else {
          setMatchSel({ kind: 'not-found' });
        }
      }
      setSel({ selection: selText, context });
      setSelResult('');
      if (!controller) { setSelError(true); return; }
      // Read the LIVE selection (poll may run in an old closure) from refs, so a
      // mid-session language change always takes effect.
      const src = sourceRef.current;
      const tgt = targetRef.current;
      const customs = customLangsRef.current;
      // Resolve the effective source language: if the user picked "auto", run the
      // heuristic detector; only if that is ambiguous (multiple same-script langs
      // or a low-confidence Latin read) do we call the LLM classifier.
      let effSource = src;
      try {
        if (src === AUTO_DETECT.code) {
          const all = allLangs(customs);
          const d = detectByScript(selText, all);
          if (needsLlmDetect(d, all) && controller.detectLanguage) {
            try {
              const code = await controller.detectLanguage(selText);
              effSource = resolveLangCode(code, customs);
              setDetected(langName(effSource, customs));
            } catch {
              effSource = d.script === 'latin' ? 'en' : d.lang;
              setDetected(langName(effSource, customs));
            }
          } else {
            effSource = d.lang;
            setDetected(langName(effSource, customs));
          }
          if (seq !== reqSeq.current) return;
        } else {
          setDetected('');
        }
      } catch { setDetected(''); }
      // Effective domain: the user's pinned choice wins; otherwise fall back to
      // the DOCUMENT-level domain the LLM judged when the doc was loaded (not
      // the selection). Inject terms when a domain is active.
      const userDomain = domainRef.current;
      const effDomain = userDomain || docDomainRef.current || undefined;
      let injectedTerms: { source: string; target?: string }[] = [];
      let queryWarnings: string[] = [];
      if (effDomain && controller.queryTerms && selText) {
        try {
          const q = await controller.queryTerms({ domain: effDomain, sourceLang: effSource || 'en', targetLang: tgt, text: selText });
          injectedTerms = (Array.isArray(q?.hits) ? q.hits : [])
            .filter((h: any) => h?.source && h?.target)
            .map((h: any) => ({ source: String(h.source), target: String(h.target) }));
          queryWarnings = Array.isArray(q?.warnings) ? q.warnings : [];
          if (seq !== reqSeq.current) return;
        } catch { injectedTerms = []; queryWarnings = []; }
      }
      setDetectedDomain(userDomain ? '' : docDomainRef.current);
      setTermWarnings(queryWarnings);
      try {
        const res = await controller.translateSelection(
          { kind: 'selection', selection: selText, context, glossary, source: effSource, target: tgt, domain: effDomain, terms: injectedTerms },
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

    const [showAddLang, setShowAddLang] = useState(false);
    const [addLangName, setAddLangName] = useState('');
    const addCustomLang = (): void => {
      const name = addLangName.trim();
      if (!name) return;
      const next: Lang = { code: 'x-' + Date.now().toString(36), name, native: name, prompt: name, script: 'other', custom: true };
      setCustomLangs((prev: any) => [...prev, next]);
      setAddLangName('');
      setShowAddLang(false);
    };

    // A compact language select: options = auto (source only) + preset + customs.
    const langOptions = (includeAuto: boolean) =>
      (includeAuto ? [AUTO_DETECT, ...allLangs(customLangs)] : allLangs(customLangs));
    const langLabel = (code: string): string => {
      if (code === AUTO_DETECT.code) return AUTO_DETECT.name;
      const all = allLangs(customLangs);
      const f = all.find((l) => l.code === code);
      return f ? f.name : code;
    };
    const selectStyle = { height: 26, padding: '0 8px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontSize: 13, outline: 'none' };

    // Domain options (from the seed graph, flattened). '' = 不指定领域（不注入术语）。
    const DOMAIN_OPTIONS = [
      { value: '', label: '领域（不指定）' },
      { value: 'machine-learning', label: '机器学习' },
      { value: 'deep-learning', label: '深度学习' },
      { value: 'nlp', label: '自然语言处理' },
      { value: 'computer-vision', label: '计算机视觉' },
      { value: 'reinforcement-learning', label: '强化学习' },
      { value: 'biology', label: '生物学' },
      { value: 'genetics', label: '遗传学' },
      { value: 'physics', label: '物理学' },
      { value: 'quantum-computing', label: '量子计算' },
      { value: 'software-engineering', label: '软件工程' },
      { value: 'math', label: '数学' },
    ];
    const domainLabel = (v: string): string => DOMAIN_OPTIONS.find((o) => o.value === v)?.label ?? v;

    const bottom = h('div', { style: { flex: 1, overflow: 'auto', padding: 12, borderTop: '1px solid #e2e2e2', color: '#1f2329' } },
      h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', color: '#555' } },
        clipAvailable
          ? h('span', { style: { fontSize: 13 } }, '✓ 已启用自动翻译')
          : h('button', { onClick: () => void onClipboardTranslate(), className: BTN_CLS }, '翻译选中'),
        h('label', { style: { fontSize: 13, color: '#555' } }, '源'),
        h('select', { value: source, onChange: (e: any) => setSource(e.target.value), style: selectStyle },
          langOptions(true).map((l: any) => h('option', { value: l.code, key: l.code }, langLabel(l.code))),
          h('option', { value: '__custom', key: '__custom' }, '＋语言…'),
        ),
        h('label', { style: { fontSize: 13, color: '#555' } }, '目标'),
        h('select', { value: target, onChange: (e: any) => { const v = e.target.value; if (v === '__custom') { setShowAddLang(true); } else { setTarget(v); } }, style: selectStyle },
          langOptions(false).map((l: any) => h('option', { value: l.code, key: l.code }, langLabel(l.code))),
          h('option', { value: '__custom', key: '__custom' }, '＋语言…'),
        ),
        h('label', { style: { fontSize: 13, color: '#555' } }, '领域'),
        h('select', { value: domain, onChange: (e: any) => setDomain(e.target.value), style: selectStyle },
          DOMAIN_OPTIONS.map((o: any) => h('option', { value: o.value, key: o.value }, o.label)),
        ),
        h('label', { style: { fontSize: 13, color: '#555' } }, '上下文'),
        h('input', { type: 'range', min: 0, max: 800, step: 50, value: contextLen, onChange: (e: any) => setContextLen(Number(e.target.value)), style: { width: 160, accentColor: '#555' } }),
        h('span', { style: { fontSize: 13, color: '#555' } }, contextLen + ' 字'),
      ),
      showAddLang
        ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
            h('input', { value: addLangName, placeholder: '语言名（如 法语 / French）', onChange: (e: any) => setAddLangName(e.target.value), style: { ...inputBase, flex: 1 } }),
            h('button', { onClick: addCustomLang, className: BTN_CLS }, '添加'),
            h('button', { onClick: () => setShowAddLang(false), className: BTN_CLS }, '取消'),
          )
        : undefined,
      detected
        ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '识别为：' + detected)
        : undefined,
      detectedDomain && !domain
        ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
            'LLM 判断领域：' + domainLabel(detectedDomain))
        : undefined,
      domain && termWarnings.length > 0
        ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-warn-primary)', lineHeight: 1.6 } },
            '术语提示（领域 ' + domainLabel(domain) + '）：',
            termWarnings.map((w: string, i: number) => h('div', { key: i, style: { marginTop: 2 } }, '· ' + w)),
          )
        : undefined,
      h('div', { style: { marginTop: 10 } },
        sel
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              matchSel.kind !== 'empty'
                ? h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 } },
                    h('span', { style: { color: matchSel.kind === 'not-found' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)' } },
                      matchSel.kind === 'not-found' ? '⚠' : '✓'),
                    h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                      matchSel.kind === 'matched'
                        ? '已匹配到原文，使用上下文翻译'
                        : matchSel.kind === 'multiple'
                          ? ('该片段在原文出现 ' + (matchSel.count ?? 0) + ' 次，使用第一次出现的上下文')
                          : '未在原文中定位到该片段，直接翻译'),
                  )
                : undefined,
              h('div', { style: { color: '#666', fontSize: 13, maxHeight: 130, overflow: 'auto' } }, '原文：' + sel.selection),
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-start' } },
                h('div', { style: { flex: 1, lineHeight: 1.7, color: selError ? '#e53e3e' : '#1f2329' } }, selResult || '翻译中…'),
                selResult ? h('button', { onClick: () => void navigator.clipboard.writeText(selResult), className: BTN_CLS }, '复制译文') : undefined,
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
