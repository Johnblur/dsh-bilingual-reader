// client/PdfView.ts — native PDF display via a Blob URL in an <iframe> (the SAME approach
// the built-in better-sidebar PDF viewer uses). Guarantees pixel-perfect rendering with
// the browser's own PDF engine. Selection/translation is done via the "文本" view
// (window.getSelection() on extracted text), since the native renderer doesn't expose
// its text to JS. onSelect is kept for the text-view path (unused here).
export interface PdfViewProps { file: string; onSelect?: (text: string) => void }

interface ReactPieces {
  h: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
}

export function makePdfView({ h, useState, useEffect }: ReactPieces) {
  return function PdfView(props: PdfViewProps): any {
    const { file } = props;
    const [url, setUrl] = useState('');
    const [err, setErr] = useState('');

    useEffect(() => {
      let objectUrl: string | undefined;
      let alive = true;
      setErr('');
      setUrl('');
      (async () => {
        try {
          const res = await fetch('/bilingual-reader/file?path=' + encodeURIComponent(file));
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const bytes = await res.arrayBuffer();
          if (!alive) return;
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
          setUrl(objectUrl);
        } catch (e) {
          if (alive) setErr(e instanceof Error ? e.message : String(e));
        }
      })();
      return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [file]);

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      err ? h('p', { style: { color: '#e53e3e', padding: 12 } }, '加载失败：' + err) : undefined,
      url
        ? h('iframe', { src: url, title: 'PDF', style: { width: '100%', height: '620px', border: 0 } })
        : h('p', { style: { color: '#a0aec0', padding: 12 } }, '加载 PDF…'),
    );
  };
}
