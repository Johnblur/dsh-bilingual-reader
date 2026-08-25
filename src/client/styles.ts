// src/client/styles.ts — shared DSH-token skinning for the plugin's own chrome.
// The DSH theme package defines these `--dsw-alias-*` tokens on `body`, so they
// resolve anywhere in the host DOM in both light and dark themes. The plugin's
// controls consume the SAME tokens as dsh-better-sidebar / the app, so the whole
// plugin reads as one component set with the host (previously the top loader was a
// plain HTML form and visibly didn't belong).
export const BTN_CLS = 'dsh-bl-btn';

// Hover needs a real rule (an inline style can't express :hover), so we inject
// one CSS block once. The side effect runs at module import (guarded), so it
// works whether imported from the reader or the loader component.
export function ensurePluginStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dsh-bl-plugin-styles')) return;
  const s = document.createElement('style');
  s.id = 'dsh-bl-plugin-styles';
  s.textContent =
    '.dsh-bl-btn{display:inline-flex;align-items:center;justify-content:center;' +
    'border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);' +
    'color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:13px;' +
    'cursor:pointer}.dsh-bl-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}';
  document.head.appendChild(s);
}
ensurePluginStyles();

// Base text-input skin. Border uses the same `--dsw-alias-border-l2` as the
// button so the input reads at the same visual weight and stays easy to see.
export const inputBase: Record<string, string> = {
  height: '28px',
  padding: '0 10px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: '6px',
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: '13px',
  outline: 'none',
};
