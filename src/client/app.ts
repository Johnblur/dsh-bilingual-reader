// src/client/app.ts — builds the client factory: (require) => module { inject, apply }.
// `apply` registers the bilingual PDF viewer with better-sidebar. React is sourced
// from the factory's `require` so the client shares DSH's React instance.
import { BilingualReader } from './BilingualReader.js';

export function makeClientFactory(): (require: (m: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } {
  return (require) => {
    // touch require so externals (react) resolve through DSH's loader, not a bundled copy.
    void require;

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
