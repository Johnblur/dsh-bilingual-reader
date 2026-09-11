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
  /** Classify a paper/snippet's field/domain (shown when the domain is auto). */
  detectDomain?: (text: string) => Promise<string>;
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
    // Human-readable clipboard failure text, surfaced directly in the tab.
    // Desktop fences plugin routes to the Electron renderer, so a normal browser
    // cannot read the host route's JSON to debug it — showing the reason here is
    // the only practical channel.
    const [clipWarn, setClipWarn] = useState('');
    const [selError, setSelError] = useState(false);
    // Multi-language: persisted selection + user-added languages.
    const [customLangs, setCustomLangs] = useState(initialCustom() as any);
    const [source, setSource] = useState(initialSource());
    const [target, setTarget] = useState(initialTarget(isZhUI()));
    const [detected, setDetected] = useState('');
    // Domain (manual select or auto-detected). Persisted per session. '' =
    // auto-detect (LLM judges).
    const [domain, setDomain] = useState(loadLangBlob('dsh-bl.domain', ''));
    // User-added domains (free text; no relations needed).
    const [customDomains, setCustomDomains] = useState(loadLangBlob('dsh-bl.customDomains', []) as string[]);
    const [showAddDomain, setShowAddDomain] = useState(false);
    const [addDomainName, setAddDomainName] = useState('');
    // LLM-detected domain (from the whole extracted document text).
    const [detectedDomain, setDetectedDomain] = useState('');
    // Diagnostic strip collapsed by default; click to expand/collapse. Amber ⚠
    // when there's a warning (e.g. not-found match).
    const [diagExpanded, setDiagExpanded] = useState(false);
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
      // Domain detection: judged ONCE per document from the WHOLE extracted text
      // (not a short selection, which would misjudge the field). Stored in a ref
      // for the translate path; shown when the user leaves the dropdown blank.
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
    useEffect(() => { saveLangBlob('dsh-bl.customDomains', customDomains); }, [customDomains]);

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
      // Effective domain: the user's manual choice wins; otherwise fall back to
      // the DOCUMENT-level domain the LLM judged when the doc was loaded. Passed
      // to the translator as context (it helps when the selection can't be
      // matched in the text).
      const effDomain = domainRef.current || docDomainRef.current || undefined;
      try {
        const res = await controller.translateSelection(
          { kind: 'selection', selection: selText, context, glossary, source: effSource, target: tgt, domain: effDomain },
          new AbortController().signal, () => {},
        );
        // Only apply the result if this is still the latest request (avoid stale overwrites).
        if (seq === reqSeq.current) { setSelResult(res); setSelError(false); }
      } catch (err) {
        if (seq === reqSeq.current) { setSelResult('翻译失败：' + (err instanceof Error ? err.message : String(err))); setSelError(true); }
      }
    }

    async function onClipboardTranslate(): Promise<void> {
      // 1) Host route first — it uses the OS clipboard watcher (works when the
      //    host runs in a utilityProcess without Electron), or Electron if present.
      let text = '';
      let diag = '';
      try {
        const r = await fetch('/bilingual-reader/clipboard');
        if (!r.ok) {
          diag = ` [host route HTTP ${r.status}]`;
        } else {
          const j = await r.json();
          if (j && typeof j.text === 'string') text = j.text;
          const d = j?.debug;
          if (d) diag = ` [${d.source} mode=${d.mode || '-'} available=${d.available} polls=${d.polls ?? '-'} lines=${d.lines ?? '-'} fileOk=${d.fileOk ?? '-'}${d.err ? ' err=' + String(d.err).slice(0, 200) : ''}]`;
        }
      } catch (e) {
        diag = ` [${e instanceof Error ? e.message : String(e)}]`;
      }
      // 2) Fall back to the browser clipboard (a click is a user gesture).
      if (!text) {
        try { text = await navigator.clipboard.readText(); } catch { /* ignore */ }
      }
      if (!text) {
        setSelResult('（未能读取剪贴板：请先在 PDF 里选中并复制，然后在本页按 Ctrl+V）' + diag); setSelError(true);
        return;
      }
      try { await doTranslate(text); } catch (err) {
        setSelResult('读取剪贴板失败：' + (err instanceof Error ? err.message : String(err))); setSelError(true);
      }
    }

    // Auto-translate on copy: poll the host clipboard route; when the system clipboard
    // changes (Electron can read it), translate immediately. Button remains as a reliable
    // fallback (web / if polling is unavailable).
    useEffect(() => {
      let last = '';
      let lastBrowserTry = 0;
      let polls = 0;
      const poll = async () => {
        let text = ''; let available = false;
        let warn = '';
        polls += 1;
        try {
          const r = await fetch('/bilingual-reader/clipboard');
          if (!r.ok) {
            warn = `宿主路由返回 HTTP ${r.status}（插件路由被 Desktop 的浏览器访问围栏拦下）`;
          } else {
            const j = await r.json();
            available = !!j.available;
            text = j && typeof j.text === 'string' ? j.text : '';
            const d = j?.debug || {};
            // The host watcher may be alive yet unable to read anything (e.g. its
            // helper process has no clipboard access in that environment). In that
            // case it reports why, and `available` must not claim success —
            // otherwise the ✓ lies and no fallback is ever attempted.
            if (d.err && !d.lines && !d.fileOk) {
              available = false;
              warn = `剪贴板助手报告失败：${d.err}（读法 ${d.mode || '未知'}）`;
            } else if (!d.lines && !d.fileOk && (d.polls ?? polls) > 25) {
              // Alive but silent: the helper process started and never once
              // produced text, which means reads are failing without throwing.
              warn = `剪贴板助手已启动（读法 ${d.mode || '未知'}）但始终读不到内容`
                + `，宿主路由被请求 ${d.polls ?? polls} 次仍未收到任何文本`
                + (d.bytes ? `；stdout 收到 ${d.bytes} 字节但无法解析` : '；stdout 无任何输出');
            }
          }
        } catch (e) {
          warn = `无法访问宿主路由：${e instanceof Error ? e.message : String(e)}`;
        }
        // Fall back to the browser clipboard: on a user gesture for the button,
        // and here opportunistically (a denied read just rejects silently).
        let browserDenied = false;
        if (!available && typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
          try { const t = await navigator.clipboard.readText(); if (t) { text = t; available = true; } } catch { browserDenied = true; }
        } else if (!text && typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
          const now = Date.now();
          if (now - lastBrowserTry > 3000) {
            lastBrowserTry = now;
            try { const t = await navigator.clipboard.readText(); if (t) { text = t; available = true; } } catch { /* denied */ }
          }
        }
        if (!available && browserDenied) warn += warn ? '；' : '（浏览器剪贴板读取也被拒绝）';
        setClipAvailable(available);
        setClipWarn(warn);
        if (text && text !== last) { last = text; await doTranslate(text); }
        else if (!text) last = '';
      };
      const id = setInterval(poll, 400);
      return () => clearInterval(id);
    }, [doc, glossary, controller, contextLen]);

    // Last-resort capture that needs NO permission and no host API: paste.
    // `navigator.clipboard.readText()` can be denied and the host may have no
    // clipboard source at all, but a real Ctrl+V always carries the text. So
    // after copying a selection in the PDF, Ctrl+V inside this tab translates it.
    useEffect(() => {
      const onPaste = (e: any) => {
        const t = e?.target as any;
        const tag = String(t?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return;
        const text = e?.clipboardData?.getData?.('text') || '';
        if (!text.trim()) return;
        e.preventDefault?.();
        void doTranslate(text);
      };
      window.addEventListener('paste', onPaste);
      return () => window.removeEventListener('paste', onPaste);
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
    const selectStyle = { height: 24, padding: '0 4px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontSize: 12, outline: 'none', maxWidth: 120 };
    const rangeStyle = { width: 110, accentColor: '#555' };

    // Built-in domain set + user-added (free text). '' = auto-detect.
    const BASE_DOMAINS = [
      { value: '', label: '自动识别' },
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
    const DOMAIN_OPTIONS = [
      ...BASE_DOMAINS,
      ...customDomains.map((d: any) => ({ value: d, label: d })),
    ];
    const domainLabel = (v: string): string => DOMAIN_OPTIONS.find((o) => o.value === v)?.label ?? v;
    const addCustomDomain = (): void => {
      const name = addDomainName.trim();
      if (!name) return;
      if (!customDomains.includes(name)) setCustomDomains((prev: any) => [...prev, name]);
      setAddDomainName('');
      setShowAddDomain(false);
    };

    const bottom = h('div', { style: { flex: 1, overflow: 'auto', padding: 12, borderTop: '1px solid #e2e2e2', color: '#1f2329' } },
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: '#555' } },
        clipAvailable
          ? h('span', { title: '已启用自动翻译', style: { fontSize: 14, color: 'var(--dsw-alias-state-success-primary)', lineHeight: 1 } }, '✓')
          : h('button', { onClick: () => void onClipboardTranslate(), className: BTN_CLS, style: { fontSize: 12, padding: '2px 8px' } }, '翻译'),
        h('select', { value: source, onChange: (e: any) => setSource(e.target.value), style: selectStyle, title: '源语言' },
          langOptions(true).map((l: any) => h('option', { value: l.code, key: l.code }, langLabel(l.code))),
          h('option', { value: '__custom', key: '__custom' }, '＋语言…'),
        ),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', color: 'var(--dsw-alias-label-tertiary)' } },
          h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' },
            h('path', { d: 'M5 12h14' }),
            h('path', { d: 'M13 6l6 6-6 6' }),
          ),
        ),
        h('select', { value: target, onChange: (e: any) => { const v = e.target.value; if (v === '__custom') { setShowAddLang(true); } else { setTarget(v); } }, style: selectStyle, title: '目标语言' },
          langOptions(false).map((l: any) => h('option', { value: l.code, key: l.code }, langLabel(l.code))),
          h('option', { value: '__custom', key: '__custom' }, '＋语言…'),
        ),
        h('label', { style: { fontSize: 12, color: '#555' } }, '领域'),
        h('select', { value: domain, onChange: (e: any) => { const v = e.target.value; if (v === '__custom') { setShowAddDomain(true); } else { setDomain(v); } }, style: selectStyle },
          DOMAIN_OPTIONS.map((o: any) => h('option', { value: o.value, key: o.value }, o.label)),
          h('option', { value: '__custom', key: '__custom' }, '＋领域…'),
        ),
        h('label', { style: { fontSize: 12, color: '#555' } }, '上下文'),
        h('input', { type: 'range', min: 0, max: 800, step: 50, value: contextLen, onChange: (e: any) => setContextLen(Number(e.target.value)), style: rangeStyle }),
        h('span', { style: { fontSize: 12, color: '#555' } }, contextLen + ' 字'),
      ),
      clipWarn
        ? h('div', {
            style: {
              marginTop: 8, fontSize: 12, lineHeight: 1.6, wordBreak: 'break-word',
              color: 'var(--dsw-alias-state-warn-primary)',
            },
          }, '⚠ ' + clipWarn)
        : undefined,
      (showAddLang || showAddDomain)
        ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 } },
            h('input', { value: showAddDomain ? addDomainName : addLangName, placeholder: showAddDomain ? '领域名（如 经济学）' : '语言名（如 法语 / French）', onChange: (e: any) => { if (showAddDomain) setAddDomainName(e.target.value); else setAddLangName(e.target.value); }, style: { ...inputBase, flex: 1 } }),
            h('button', { onClick: () => { if (showAddDomain) addCustomDomain(); else addCustomLang(); }, className: BTN_CLS }, '添加'),
            h('button', { onClick: () => { setShowAddDomain(false); setShowAddLang(false); }, className: BTN_CLS }, '取消'),
          )
        : undefined,
      (() => {
        // Diagnostic strip: one-line summary of detected language · domain ·
        // match status. Click to expand/collapse (user-controlled). A not-found
        // match tints it amber with ⚠, but keeps it collapsed.
        const hasWarn = matchSel.kind === 'not-found';
        const open = diagExpanded;
        const parts: string[] = [];
        if (detected) parts.push('识别为 ' + detected.replace(/（.*?）$/, ''));
        if (detectedDomain && !domain) parts.push('领域 ' + domainLabel(detectedDomain));
        if (domain) parts.push('领域 ' + domainLabel(domain));
        if (matchSel.kind === 'matched') parts.push('已匹配上下文');
        else if (matchSel.kind === 'multiple') parts.push('出现 ' + (matchSel.count ?? 0) + ' 次，用第一次');
        else if (matchSel.kind === 'not-found') parts.push('未定位到原文');
        const summary = parts.join(' · ') || '暂无状态';
        return h('div', { style: { marginTop: 8 } },
          h('button', {
            onClick: () => setDiagExpanded((v: any) => !v),
            style: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', padding: 0, color: hasWarn ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-tertiary)', fontSize: 12, cursor: 'pointer' },
          },
            h('span', { style: { fontSize: 12 } }, (hasWarn ? '⚠ ' : '') + summary),
            h('span', { style: { fontSize: 10, opacity: 0.7 } }, open ? '▾' : '▸'),
          ),
          open
            ? h('div', { style: { marginTop: 6, fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } },
                detected ? h('div', {}, '识别为：' + detected) : undefined,
                (detectedDomain && !domain) ? h('div', {}, 'LLM 判断领域：' + domainLabel(detectedDomain)) : undefined,
                matchSel.kind !== 'empty'
                  ? h('div', {}, matchSel.kind === 'matched'
                      ? '已匹配到原文，使用上下文翻译'
                      : matchSel.kind === 'multiple'
                        ? ('该片段在原文出现 ' + (matchSel.count ?? 0) + ' 次，使用第一次出现的上下文')
                        : '未在原文中定位到该片段，直接翻译')
                  : undefined,
              )
            : undefined,
        );
      })(),
      h('div', { style: { marginTop: 10 } },
        sel
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
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
