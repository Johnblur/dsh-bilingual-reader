// src/client.tsx — client bundle entry: exports the better-sidebar registration
// (apply/inject) and the BilingualReader component.
export { apply, inject } from './client/register.js';
export { BilingualReader } from './client/BilingualReader.js';
export type { ReaderController } from './client/BilingualReader.js';
