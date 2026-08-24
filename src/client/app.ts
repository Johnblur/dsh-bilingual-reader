// src/client/app.ts — client factory: (require) => module { inject, apply }.
// React is sourced from the factory's `require` (single DSH React instance), and the
// viewer component is built from those React pieces. `import type ... from 'react'`
// is TYPE-ONLY (erased at runtime), so it does not bundle into the classic-script client.
import { makeReader } from './reader.js';
import type * as ReactNS from 'react';

export function makeClientFactory(): (require: (m: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } {
  return (require) => {
    const react = require('react') as typeof ReactNS;
    const BilingualReader = makeReader({
      h: react.createElement as any,
      useState: react.useState as any,
      useEffect: react.useEffect as any,
      useCallback: react.useCallback as any,
    });

    const inject = ['betterSidebar', 'slots'];
    const apply = (ctx: unknown) => {
      const c = ctx as { betterSidebar?: unknown; effect: (fn: unknown) => unknown };
      const bs = c.betterSidebar as { registerFileViewer: (d: unknown) => () => void } | undefined;
      if (!bs) return;
      c.effect(() =>
        bs.registerFileViewer({
          name: 'bilingual-reader',
          title: '双语阅读',
          fileTypes: ['pdf'],
          component: BilingualReader,
        }),
      );
    };

    return { inject, apply };
  };
}
