// src/client/index.ts — CLIENT bundle entry (side-effect wrapper).
// Tsdown builds this into lib/client.js wrapped in `window.__ModuleLoader__.load`.
// Must be a plain side-effect script: no top-level ESM export. React is obtained
// by the factory via the `require` DSH passes (so there's a single React instance).
import { makeClientFactory } from './app.js';

declare const window: {
  __ModuleLoader__: {
    load(info: { id: string; factory: (require: (m: string) => unknown) => unknown }): void;
  };
};

window.__ModuleLoader__.load({
  id: 'dsh-bilingual-reader',
  factory: makeClientFactory(),
});
