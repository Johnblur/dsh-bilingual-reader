// client/TranslationPane.tsx — fixed right panel for selection translation (no floating window).
import * as React from 'react';
import type { SelectionContext } from './hooks.js';

export interface TranslationPaneProps {
  last?: SelectionContext;
  result?: string;
  busy?: boolean;
  error?: string;
  onCopy?: () => void;
}

export function TranslationPane(props: TranslationPaneProps): JSX.Element {
  const { last, result, busy, error, onCopy } = props;
  return (
    <aside className="br-pane" style={{ width: 360, borderLeft: '1px solid #e2e8f0', padding: 12 }}>
      <div className="br-pane-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>划词翻译</strong>
        <button onClick={onCopy} disabled={!result}>复制译文</button>
      </div>
      {!last && <p style={{ color: '#a0aec0' }}>在阅读视图里选中文字后，译文会显示在这里。</p>}
      {last && (
        <>
          <div className="br-selection" style={{ marginTop: 8 }}>
            <small>选中：</small>
            <blockquote style={{ borderLeft: '2px solid #cbd5e0', paddingLeft: 8, margin: '4px 0' }}>{last.selection}</blockquote>
          </div>
          <div className="br-context" style={{ marginTop: 8 }}>
            <small>取用上下文（前后各若干段）：</small>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: '#718096' }}>{last.context}</pre>
          </div>
        </>
      )}
      <div className="br-result" style={{ marginTop: 12 }}>
        {busy && <span>翻译中…</span>}
        {!busy && error && <span style={{ color: '#e53e3e' }}>{error}</span>}
        {!busy && !error && result && <div style={{ lineHeight: 1.7 }}>{result}</div>}
      </div>
    </aside>
  );
}
