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
    const { useState } = react;
    const h = react.createElement as any;
    const BilingualReader = makeReader({ h, useState, useEffect: react.useEffect as any, useCallback: react.useCallback as any, useRef: react.useRef as any });

    const controller = {
      loadDocument: (file: string) => post('/bilingual-reader/extract', { path: file }),
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
      const [path, setPath] = useState('');
      const [chosen, setChosen] = useState('');
      return h('div', { style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 8, height: '100%' } },
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { value: path, placeholder: '粘贴或输入 PDF 路径…', onChange: (e: any) => setPath(e.target.value), style: { ...inputBase, flex: 1 } }),
          h('button', { onClick: () => setChosen(path), className: BTN_CLS }, '加载'),
        ),
        chosen
          ? h(BilingualReader, { file: chosen, controller })
          : h('p', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 13 } }, '输入一个 PDF 路径（默认工作区目录），点「加载」开始双语阅读。'),
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
      // own tabs use). English UI → "translator", Chinese UI → "翻译". This is the single
      // title field the tab bar, + menu, and settings card all render, so language-aware
      // is the standard (规范) way and matches better-sidebar's native tabs.
      const isZh = () =>
        (c.locale?.getSnapshot?.().active ?? (typeof navigator !== 'undefined' ? navigator.language : ''))
          .toLowerCase()
          .startsWith('zh');
      c.effect(() =>
        bs.registerTab({
          id: 'bilingual-reader',
          title: () => (isZh() ? '翻译' : 'translator'),
          icon: (size: number) => languageIcon(h, size),
          component: ReaderTab,
        }),
      );
    };

    return { inject, apply };
  };
}
