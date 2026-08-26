// src/client/app.ts — client factory: (require) => module { inject, apply }.
// Registers a proper better-sidebar TAB and gives it a fetch-based controller that
// calls the host /bilingual-reader/* routes (extract + isolated translate).
// React is sourced from the factory's `require` (single DSH React instance).
import { makeReader } from './reader.js';
import { BTN_CLS, inputBase } from './styles.js';
import type * as ReactNS from 'react';

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

// A "translate / languages" glyph matching better-sidebar's 16px outline icon
// style: stroke uses currentColor, no fill, so it inherits the tab's ink and
// adapts to light/dark automatically. Hand-built SVG (no icon dep).
function languageIcon(h: (...args: any[]) => any, size: number): any {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 2,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
    h('path', { d: 'M5 8l6 6' }),
    h('path', { d: 'M4 14l6-6 2-3' }),
    h('path', { d: 'M2 5h12' }),
    h('path', { d: 'M7 2h1' }),
    h('path', { d: 'm22 22-5-10-5 10' }),
    h('path', { d: 'M14 18h6' }),
  );
}

export function makeClientFactory(): (require: (m: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } {
  return (require) => {
    const react = require('react') as typeof ReactNS;
    const { useState, useEffect } = react;
    const h = react.createElement as any;
    const BilingualReader = makeReader({ h, useState, useEffect: react.useEffect as any, useCallback: react.useCallback as any, useRef: react.useRef as any });

    const controller = {
      loadDocument: (file: string) => post('/bilingual-reader/extract', { path: file }),
      listPdfs: (dir: string, limit = 200) => post('/bilingual-reader/list-pdfs', { dir, limit }),
      translateChunk: async (chunkId: string, _glossary: Record<string, string>, _signal: AbortSignal, emit: (e: any) => void) => {
        emit({ type: 'start', requestId: chunkId });
        const r = await post('/bilingual-reader/translate-chunk', { chunkId });
        if (r && typeof r.text === 'string') { emit({ type: 'done', requestId: chunkId, full: r.text }); return r.text; }
        throw new Error((r && r.error) || 'translate-chunk failed');
      },
      translateSelection: async (req: any, _signal: AbortSignal, _emit: (e: any) => void) => {
        const r = await post('/bilingual-reader/translate-selection', req);
        if (r && typeof r.text === 'string') return r.text;
        throw new Error((r && r.error) || ('translate-selection failed: ' + JSON.stringify(r)));
      },
    };

    function ReaderTab(props: any): any {
      const scope = props?.scope;
      const cwd: string = scope?.cwd ?? '';
      const [path, setPath] = useState('');
      const [chosen, setChosen] = useState('');
      const [browsing, setBrowsing] = useState(false);
      const [pdfs, setPdfs] = useState<{ path: string; name: string }[]>([]);
      const [browseErr, setBrowseErr] = useState('');
      const [loading, setLoading] = useState(false);

      // Lazy-load the PDF list when the picker is opened.
      useEffect(() => {
        if (!browsing || !cwd) return;
        let cancelled = false;
        setLoading(true);
        setBrowseErr('');
        controller.listPdfs(cwd, 200)
          .then((r: any) => { if (!cancelled) setPdfs(Array.isArray(r?.files) ? r.files : []); })
          .catch((e: any) => { if (!cancelled) { setPdfs([]); setBrowseErr('列出 PDF 失败：' + (e instanceof Error ? e.message : String(e))); } })
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
      }, [browsing, cwd]);

      const pick = (p: string) => { setPath(p); setChosen(p); setBrowsing(false); };

      return h('div', { style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 8, height: '100%' } },
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { value: path, placeholder: '粘贴或输入 PDF 路径…', onChange: (e: any) => setPath(e.target.value), style: { ...inputBase, flex: 1 } }),
          h('button', { onClick: () => setChosen(path), className: BTN_CLS }, '加载'),
          h('button', { onClick: () => setBrowsing(v => !v), className: BTN_CLS }, '浏览…'),
        ),
        browsing
          ? h('div', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, maxHeight: 260, overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 2 } },
              loading
                ? h('p', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, padding: '4px 6px' } }, '正在扫描 PDF…')
                : browseErr
                  ? h('p', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13, padding: '4px 6px' } }, browseErr)
                  : pdfs.length === 0
                    ? h('p', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, padding: '4px 6px' } }, cwd ? ('未找到 PDF：' + cwd) : '未提供工作区目录。')
                    : pdfs.map((p) => h('button', {
                        key: p.path,
                        onClick: () => pick(p.path),
                        style: { textAlign: 'left', border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 13, borderRadius: 4, padding: '4px 6px', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                      }, p.name)),
            )
          : undefined,
        chosen
          ? h(BilingualReader, { file: chosen, controller })
          : h('p', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 } }, '输入一个 PDF 路径，点「加载」开始双语阅读；或点「浏览…」从工作区选择。'),
      );
    }

    const inject = ['betterSidebar', 'slots', 'locale'];
    const apply = (ctx: unknown) => {
      const c = ctx as {
        betterSidebar?: unknown;
        locale?: { getSnapshot: () => { active: string } };
        effect: (fn: unknown) => unknown;
      };
      const bs = c.betterSidebar as { registerTab: (d: unknown) => () => void } | undefined;
      if (!bs) return;
      // DSH i18n: the active locale comes from ctx.locale (same source better-sidebar's
      // own tabs use). This `title` feeds the + menu and the settings card, so there we
      // show the localized name: Chinese UI → "翻译", English UI → "translator".
      const isZh = () =>
        (c.locale?.getSnapshot?.().active ?? (typeof navigator !== 'undefined' ? navigator.language : ''))
          .toLowerCase()
          .startsWith('zh');
      c.effect(() =>
        bs.registerTab({
          id: 'bilingual-reader',
          title: () => (isZh() ? '翻译' : 'translator'),
          icon: (size: number) => languageIcon(h, size),
          // Tab-BAR label. The tab bar renders the title frozen into tab.title when the
          // tab is opened (it does NOT call title() live like the + menu does), so the
          // user wants the tab strip to always read English "translator". We mint the
          // tab ourselves so the stored title is a fixed English string regardless of
          // the active UI language.
          single: true,
          createTab: () => ({
            tab: { id: 'bilingual-reader', type: 'bilingual-reader', title: 'translator' },
          }),
          component: ReaderTab,
        }),
      );
    };

    return { inject, apply };
  };
}
