// src/client/app.ts — client factory: (require) => module { inject, apply }.
// Registers a proper better-sidebar TAB and gives it a fetch-based controller that
// calls the host /bilingual-reader/* routes (extract + isolated translate).
// React is sourced from the factory's `require` (single DSH React instance).
import { makeReader } from './reader.js';
import type * as ReactNS from 'react';

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

export function makeClientFactory(): (require: (m: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } {
  return (require) => {
    const react = require('react') as typeof ReactNS;
    const { useState } = react;
    const h = react.createElement as any;
    const BilingualReader = makeReader({ h, useState, useEffect: react.useEffect as any, useCallback: react.useCallback as any });

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
      const scope = props?.scope;
      const cwd: string = scope?.cwd ?? '';
      const [path, setPath] = useState(cwd ? `${cwd}\\` : '');
      const [chosen, setChosen] = useState('');
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
