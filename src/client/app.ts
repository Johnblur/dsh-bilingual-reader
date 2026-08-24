// src/client/app.ts — client factory: (require) => module { inject, apply }.
// Registers a proper better-sidebar TAB (id/title/component) — NOT a file viewer —
// so it is compatible with sidebar updates and never breaks the viewer inventory.
// React is sourced from the factory's `require` (single DSH React instance).
import { makeReader } from './reader.js';
import type * as ReactNS from 'react';

export function makeClientFactory(): (require: (m: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } {
  return (require) => {
    const react = require('react') as typeof ReactNS;
    const { useState } = react;
    const h = react.createElement as any;
    const BilingualReader = makeReader({ h, useState, useEffect: react.useEffect as any, useCallback: react.useCallback as any });

    // Tab body: a small path picker + the reader. The host facade (extract/translate)
    // is wired below via a route the host registers; TODO wire when host channel lands.
    function ReaderTab(props: any): any {
      const scope = props?.scope;
      const cwd: string = scope?.cwd ?? '';
      const [path, setPath] = useState(cwd ? `${cwd}\\` : '');
      const [chosen, setChosen] = useState('');
      const controller = (props?.ctx?.bilingualReader as any);
      return h('div', { style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 8, height: '100%' } },
        h('div', { style: { display: 'flex', gap: 8 } },
          h('input', { value: path, onChange: (e: any) => setPath(e.target.value), style: { flex: 1 } }),
          h('button', { onClick: () => setChosen(path) }, '加载'),
        ),
        chosen
          ? h(BilingualReader, { file: chosen, controller })
          : h('p', { style: { color: '#a0aec0' } }, '输入一个 PDF 路径（默认工作区目录），点「加载」开始双语阅读。'),
      );
    }

    const inject = ['betterSidebar', 'slots'];
    const apply = (ctx: unknown) => {
      const c = ctx as { betterSidebar?: unknown; effect: (fn: unknown) => unknown };
      const bs = c.betterSidebar as { registerTab: (d: unknown) => () => void } | undefined;
      if (!bs) return;
      c.effect(() =>
        bs.registerTab({
          id: 'bilingual-reader',
          title: '双语阅读',
          component: ReaderTab,
        }),
      );
    };

    return { inject, apply };
  };
}
