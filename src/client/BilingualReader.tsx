// client/BilingualReader.tsx — top-level container wiring host extraction + translation into the UI.
import * as React from 'react';
import { ReaderView } from './ReaderView.js';
import { TranslationPane } from './TranslationPane.js';
import { buildSelectionContext, useTranslationStream, type SelectionContext } from './hooks.js';
import type { DocChunk, DocumentText, TranslateEvent, TranslateRequest } from '../types.js';

export interface ReaderController {
  loadDocument: (file: string) => Promise<{ text: DocumentText; chunks: DocChunk[]; glossary: Record<string, string> }>;
  translateChunk: (chunkId: string, glossary: Record<string, string>, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
  translateSelection: (req: TranslateRequest, signal: AbortSignal, emit: (e: TranslateEvent) => void) => Promise<string>;
}

export function BilingualReader(props: { file?: string; controller?: ReaderController }): JSX.Element {
  const { file = '', controller } = props;
  const [chunks, setChunks] = React.useState<DocChunk[]>([]);
  const [doc, setDoc] = React.useState<DocumentText | null>(null);
  const [glossary, setGlossary] = React.useState<Record<string, string>>({});
  const [mode, setMode] = React.useState<'original' | 'translation' | 'both'>('both');
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [sel, setSel] = React.useState<SelectionContext | null>(null);
  const [selResult, setSelResult] = React.useState('');
  const { state: translations, push } = useTranslationStream();

  const load = React.useCallback(async () => {
    if (!controller || !file) return;
    const { text, chunks, glossary } = await controller.loadDocument(file);
    setDoc(text);
    setChunks(chunks);
    setGlossary(glossary);
    if (chunks[0]) {
      setBusy((b) => ({ ...b, [chunks[0].id]: true }));
      const sig = new AbortController().signal;
      await controller.translateChunk(chunks[0].id, glossary, sig, (e) => {
        push(e);
        if (e.type === 'done' || e.type === 'error') setBusy((b) => ({ ...b, [chunks[0].id]: false }));
      });
    }
  }, [controller, file, push]);

  React.useEffect(() => { void load(); }, [load]);

  async function onSelect(text: string): Promise<void> {
    if (!text || !doc) return;
    const ctx = buildSelectionContext(text, doc.fullText, doc.paragraphs, 1);
    setSel(ctx);
    setSelResult('');
    if (!controller) return;
    const signal = new AbortController().signal;
    const res = await controller.translateSelection(
      { kind: 'selection', selection: ctx.selection, context: ctx.context, glossary, target: '中文' },
      signal,
      push,
    );
    setSelResult(res);
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ padding: 8 }}>
          <span>显示：</span>
          {(['original', 'both', 'translation'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{ marginLeft: 4 }}>{m}</button>
          ))}
        </div>
        <ReaderView chunks={chunks} translations={translations} show={mode} busy={busy} onSelect={onSelect} />
      </div>
      <TranslationPane last={sel ?? undefined} result={selResult} />
    </div>
  );
}
