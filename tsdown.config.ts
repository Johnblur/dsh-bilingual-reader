// tsdown.config.ts — builds host (lib/index.js) + client (lib/client.js) ESM bundles.
// Output mirrors package.json exports ("lib/"), platform=node so Node built-ins
// (node:fs/path/crypto) are recognized instead of warning; peer/installed deps are
// externalized via deps.neverBundle so lib/ stays lean (DSH provides react; pdfjs-dist
// is installed as a dependency and resolved at runtime).
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.tsx',
  },
  format: ['esm'],
  outDir: 'lib',
  target: 'es2022',
  platform: 'node',
  clean: true,
  dts: false,
  deps: {
    neverBundle: ['react', 'react-dom', 'pdfjs-dist'],
  },
});
