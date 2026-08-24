// tsdown.config.ts — two builds:
//  * host  (src/index.ts)        -> lib/index.mjs  (ESM; DSH Node host loads main via ESM exports)
//  * client(src/client/index.ts) -> lib/client.js  (CJS wrapped in window.__ModuleLoader__.load)
// Output matches package.json: main = lib/index.mjs, exports["./client"] = lib/client.js.
//
// VERIFY: follows the DSH/office-plugin convention (client = CJS __ModuleLoader__ factory
// bundle with react externalized via the factory's `require`). Adjust if your tsdown differs.
import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    name: 'host',
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'lib',
    target: 'es2022',
    platform: 'node',
    clean: true,
    dts: false,
    deps: { neverBundle: ['pdfjs-dist', 'pdfjs-dist/legacy/build/pdf.mjs', '@deepseek-ai/dsh-llm', '@napi-rs/canvas'] },
  },
  {
    name: 'client',
    entry: { client: 'src/client/index.ts' },
    format: ['cjs'],
    outDir: 'lib',
    target: 'es2022',
    platform: 'browser',
    dts: false,
    deps: { neverBundle: ['react', 'react-dom'] },
  },
]);
