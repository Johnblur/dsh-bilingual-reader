// client/register.ts — register a PDF "bilingual reader" file viewer in better-sidebar.
// We deliberately do NOT import 'dsh-better-sidebar' types here: that package is
// provided by the running DSH (not fetched from npm), and its exact descriptor
// shape is a VERIFY point. We type the service surface minimally so the project
// can typecheck/build standalone; DSH supplies the real runtime.
import type { ComponentType } from 'react';
import { BilingualReader } from './BilingualReader.js';
import type { ReaderController } from './BilingualReader.js';

/** Minimal surface we consume from DSH's `ctx.betterSidebar`. VERIFY against your .d.ts. */
interface BetterSidebarService {
  registerFileViewer: (d: {
    name: string;
    title?: string;
    fileTypes?: string[];
    component: ComponentType<{ file?: string; controller?: ReaderController }>;
  }) => () => void;
  registerTab?: (d: unknown) => () => void;
}

export const inject = ['betterSidebar'];

export function apply(ctx: { betterSidebar: unknown; effect: (fn: unknown) => unknown }): void {
  const bs = ctx.betterSidebar as BetterSidebarService;
  if (!bs) return;
  ctx.effect(() =>
    bs.registerFileViewer({
      name: 'bilingual-reader',
      title: '双语阅读',
      fileTypes: ['pdf'],
      component: BilingualReader,
    }),
  );
}
