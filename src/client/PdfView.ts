// client/PdfView.ts — native PDF display via a Blob URL in an <iframe> that fills its
// container (so it stays full when the split divider is dragged). Error state in red.
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

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%' } },
      err
        ? h('div', { style: { color: '#e53e3e', padding: 12, fontSize: 13 } }, '加载失败：' + err)
        : url
          ? h('iframe', { src: url, title: 'PDF', style: { flex: 1, width: '100%', border: 0, background: '#fff' } })
          : h('p', { style: { color: '#8a8a8a', padding: 12 } }, '加载 PDF…'),
    );
  };
}
