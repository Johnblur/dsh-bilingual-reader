// src/client/termsView.ts — term + domain graph management view (read-only, 2.1).
// Opened as its own better-sidebar tab; the user can drag it out to a wide free
// window for room. Reads the glossary + domain graph from the host on mount.
// The domain graph is drawn as a pure-SVG DAG (no deps; a small per-user
// taxonomy, not hundreds of nodes).
import type { ReaderController } from './reader.js';
import { layoutDomainGraph } from '../shared/domainLayout.js';

interface ReactPieces {
  h: (...args: any[]) => any;
  useState: (...args: any[]) => any;
  useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
}

interface TermEntry {
  id: string; domains: string[]; terms: Record<string, string>;
  confidence: number; confirmedByUser: boolean; source: string; firstSeen: number;
}
interface DomainGraph { roots: string[]; edges: Record<string, string[]> }

export function makeTermsView({ h, useState, useEffect }: ReactPieces) {
  return function TermsView(props: { controller?: ReaderController }): any {
    const { controller } = props as { controller?: ReaderController };
    const [terms, setTerms] = useState(null as TermEntry[] | null);
    const [graph, setGraph] = useState(null as DomainGraph | null);
    const [err, setErr] = useState('');

    useEffect(() => {
      let alive = true;
      (async () => {
        try {
          if (!controller || !controller.getTerms) { if (alive) setErr('未连接术语服务'); return; }
          const r: any = await controller.getTerms();
          if (!alive) return;
          setTerms(Array.isArray(r?.terms) ? r.terms : []);
          setGraph(r?.graph ?? null);
        } catch (e) { if (alive) setErr(e instanceof Error ? e.message : String(e)); }
      })();
      return () => { alive = false; };
    }, [controller]);

    const termsStyle: any = { fontSize: 12, color: 'var(--dsw-alias-label-primary)', padding: '4px 0', lineHeight: 1.5 };
    const cell: any = { padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l1)', verticalAlign: 'top' };

    const domLabel = (id: string): string => id;

    return h('div', { style: { flex: 1, overflow: 'auto', padding: 12, color: '#1f2329' } },
      h('p', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)', marginBottom: 8 } },
        '术语表与领域图（只读查看）。此标签可拖出侧栏成为独立窗口。'),
      err ? h('p', { style: { color: '#e53e3e', fontSize: 13 } }, '加载失败：' + err) : undefined,

      h('h3', { style: { fontSize: 14, margin: '8px 0 4px', color: 'var(--dsw-alias-label-primary)' } }, '领域图（DAG）'),
      graph
        ? h('div', { style: { marginBottom: 12 } },
            (() => {
              const lay = layoutDomainGraph(graph);
              return h('svg', {
                width: lay.width, height: lay.height,
                viewBox: `0 0 ${lay.width} ${lay.height}`,
                style: { maxWidth: '100%', height: 'auto', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6 },
              },
                // edges
                lay.edges.map((e: any) => h('path', {
                  key: e.from + '_' + e.to,
                  d: e.path, fill: 'none',
                  stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1.5,
                })),
                // nodes
                lay.nodes.map((n: any) => h('g', { key: n.id },
                  h('rect', {
                    x: n.x, y: n.y, width: n.w, height: n.h, rx: 6, ry: 6,
                    fill: n.depth === 0 ? 'var(--dsw-alias-interactive-bg-active)' : 'var(--dsw-alias-bg-layer-2)',
                    stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1,
                  }),
                  h('text', {
                    x: n.x + n.w / 2, y: n.y + n.h / 2 + 4,
                    textAnchor: 'middle', fontSize: 11,
                    fill: 'var(--dsw-alias-label-primary)',
                  }, n.label),
                )),
              );
            })())
        : h('p', { style: termsStyle }, '（无领域数据）'),

      h('h3', { style: { fontSize: 14, margin: '8px 0 4px', color: 'var(--dsw-alias-label-primary)' } }, '术语表'),
      terms && terms.length > 0
        ? h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            h('thead', {}, h('tr', {},
              h('th', { style: { textAlign: 'left', ...cell } }, '英文'),
              h('th', { style: { textAlign: 'left', ...cell } }, '中文'),
              h('th', { style: { textAlign: 'left', ...cell } }, '领域'),
              h('th', { style: { textAlign: 'left', ...cell } }, '置信'),
              h('th', { style: { textAlign: 'left', ...cell } }, '来源'),
            )),
            h('tbody', {}, terms.map((t: any) =>
              h('tr', { key: t.id },
                h('td', { style: cell }, t.terms?.en ?? ''),
                h('td', { style: cell }, t.terms?.zh ?? ''),
                h('td', { style: cell }, (t.domains ?? []).map(domLabel).join(', ')),
                h('td', { style: cell }, String(t.confidence ?? '')),
                h('td', { style: cell }, t.source ?? ''),
              ),
            )),
          )
        : h('p', { style: termsStyle }, '（无术语数据）'),
    );
  };
}
