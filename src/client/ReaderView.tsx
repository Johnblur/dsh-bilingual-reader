// client/ReaderView.tsx — full-text bilingual reader: original above, translation below.
import * as React from 'react';
import type { DocChunk } from '../types.js';

export interface ReaderViewProps {
  chunks: DocChunk[];
  translations: Record<string, string>; // chunkId -> translated text
  show: 'original' | 'translation' | 'both'; // mode toggle
  busy?: Record<string, boolean>;
  onSelect?: (text: string) => void; // feed selection into the right pane
}

export function ReaderView(props: ReaderViewProps): JSX.Element {
  const { chunks, translations, show, busy, onSelect } = props;
  return (
    <div className="br-reader" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      {chunks.map((c) => (
        <section key={c.id} style={{ marginBottom: 8 }}>
          {c.heading && <h3 style={{ fontWeight: 600 }}>{c.heading}</h3>}
          {show !== 'translation' && (
            <div className="br-source" data-selectable onMouseUp={(e) => onSelect?.(selectionText(e))}>
              <Paragraphs text={c.text} />
            </div>
          )}
          {show !== 'original' && (
            <div className="br-translation" style={{ color: '#2b6cb0' }}>
              {translations[c.id] || (busy?.[c.id] ? '翻译中…' : '—')}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function selectionText(e: React.MouseEvent): string {
  const sel = window.getSelection();
  const txt = sel ? sel.toString() : '';
  return txt.trim();
}

function Paragraphs({ text }: { text: string }): JSX.Element {
  return <>{text.split(/\n{2,}/).map((p, i) => <p key={i} style={{ lineHeight: 1.6 }}>{p}</p>)}</>;
}
