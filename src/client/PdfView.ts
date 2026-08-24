// client/PdfView.ts — renders one PDF page image + a transparent text layer over it,
// so the user can select words directly on the rendered page and translate them.
// Page image + text coords come from host /bilingual-reader/page (same viewport => aligned).
export interface PdfViewProps { file: string; onSelect: (text: string) => void }

interface ReactPieces {
  h: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
}

export function makePdfView({ h, useState, useEffect }: ReactPieces) {
  return function PdfView(props: PdfViewProps): any {
    const { file, onSelect } = props;
    const [page, setPage] = useState(1);
    const [scale] = useState(1.6);
    const [data, setData] = useState(null);
    const [err, setErr] = useState('');

    useEffect(() => {
      let alive = true;
      setErr('');
      setData(null);
      fetch(`/bilingual-reader/page?path=${encodeURIComponent(file)}&page=${page}&scale=${scale}`)
        .then((r) => r.json())
        .then((j) => { if (alive) { if (j.error) setErr(j.error); else setData(j); } })
        .catch((e) => { if (alive) setErr(String(e)); });
      return () => { alive = false; };
    }, [page, file, scale]);

    if (err) return h('div', { style: { color: '#e53e3e', padding: 12 } }, '页图加载失败：' + err);
    if (!data) return h('div', { style: { padding: 12, color: '#a0aec0' } }, '加载页图…');

    const textLayer = h('div', {
      style: { position: 'absolute', top: 0, left: 0, width: data.width, height: data.height },
      onMouseUp: (e: any) => { const s = window.getSelection(); const t = s ? String(s) : ''; if (t.trim()) onSelect(t.trim()); },
    }, data.items.map((it: any, i: number) =>
      h('span', {
        key: i,
        style: {
          position: 'absolute', left: it.x + 'px', top: it.y + 'px', fontSize: it.fontSize + 'px',
          transformOrigin: 'left top', whiteSpace: 'pre', color: 'transparent',
        },
      }, it.text),
    ));

    return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 } },
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h('button', { onClick: () => setPage(Math.max(1, page - 1)), disabled: page <= 1 }, '上一页'),
        h('span', undefined, '第 ' + page + ' 页'),
        h('button', { onClick: () => setPage(page + 1) }, '下一页'),
      ),
      h('div', { style: { position: 'relative', width: data.width, maxWidth: '100%', overflow: 'auto' } },
        h('img', { src: data.imageDataUrl, style: { width: data.width, display: 'block' } }),
        textLayer,
      ),
    );
  };
}
