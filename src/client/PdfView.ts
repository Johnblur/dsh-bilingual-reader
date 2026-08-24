// client/PdfView.ts — renders the PDF page in the browser via pdf.js (loaded at runtime
// from the host /bilingual-reader/pdf.mjs) + pdf.js's native TextLayer, so text on the
// page is selectable with pixel-accurate positioning. Selection -> onSelect -> translate.
export interface PdfViewProps { file: string; onSelect: (text: string) => void }

interface ReactPieces {
  h: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
}

const PDFJS_URL = '/bilingual-reader/pdf.mjs';
const WORKER_URL = '/bilingual-reader/pdf.worker.mjs';
// Bypass bundler rewrite so we can import a runtime URL (pdf.js is served by the host).
const dynImport = new Function('u', 'return import(u)');

export function makePdfView({ h, useState, useEffect }: ReactPieces) {
  return function PdfView(props: PdfViewProps): any {
    const { file, onSelect } = props;
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const [hostNode, setHostNode] = useState(null);

    useEffect(() => {
      if (!hostNode) return;
      let alive = true;
      (async () => {
        try {
          const pdfjsLib: any = await dynImport(PDFJS_URL);
          pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
          const res = await fetch('/bilingual-reader/file?path=' + encodeURIComponent(file));
          const bytes = await res.arrayBuffer();
          const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
          const pg = await doc.getPage(page);
          const viewport = pg.getViewport({ scale: 1.6 });
          if (!alive) return;
          hostNode.innerHTML = '';
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const cctx = canvas.getContext('2d') as any;
          await pg.render({ canvasContext: cctx, viewport }).promise;
          const textDiv = document.createElement('div');
          textDiv.style.cssText = `position:absolute;top:0;left:0;width:${viewport.width}px;height:${viewport.height}px;`;
          const tl = new pdfjsLib.TextLayer({ textContentSource: pg.streamTextContent(), container: textDiv, viewport });
          await tl.render();
          const wrapper = document.createElement('div');
          wrapper.style.cssText = `position:relative;max-width:100%;overflow:auto;`;
          wrapper.appendChild(canvas);
          wrapper.appendChild(textDiv);
          hostNode.appendChild(wrapper);
          setErr('');
        } catch (e) {
          if (alive) setErr(e instanceof Error ? e.message : String(e));
        }
      })();
      return () => { alive = false; };
    }, [hostNode, page, file]);

    return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 } },
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h('button', { onClick: () => setPage(Math.max(1, page - 1)), disabled: page <= 1 }, '上一页'),
        h('span', undefined, '第 ' + page + ' 页'),
        h('button', { onClick: () => setPage(page + 1) }, '下一页'),
      ),
      err ? h('p', { style: { color: '#e53e3e', padding: 12 } }, '加载失败：' + err) : undefined,
      h('div', {
        ref: (n: any) => setHostNode(n),
        style: { minHeight: 200, width: '100%' },
        onMouseUp: (e: any) => { const s = window.getSelection(); const t = s ? String(s) : ''; if (t.trim()) onSelect(t.trim()); },
      }),
    );
  };
}
