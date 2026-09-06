// src/shared/domainLayout.ts — pure logic to lay out a DAG as positioned nodes.
// Zero deps. Given a DomainGraph, compute x/y (and size) for each node so they
// can be drawn on an SVG. Simple layered (BFS by depth) layout: columns by
// depth, rows within a column. Good enough for a small, shallow domain graph
// (it is a per-user taxonomy, tens of nodes at most, not hundreds).

import type { DomainGraph } from './domain.js';

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  label: string;
}

export interface LayoutEdge {
  from: string;
  to: string;
  /** Line path from parent-center to child-center (bezier-ish). */
  path: string;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** The absolute depth levels (top to bottom index order). */
  depths: string[];
}

const NODE_W = 150;
const NODE_H = 34;
const COL_GAP = 60;   // horizontal gap between depth columns
const ROW_GAP = 16;   // vertical gap between nodes in the same column
const PAD = 16;

// Compute depth of each node (root = 0). BFS over the edges; a node's depth is
// the LARGEST path from a root (so multi-parent nodes sit at their deepest level,
// which reads best for a taxonomy that fans out downward).
export function layoutDomainGraph(g: DomainGraph): LayoutResult {
  // Build child->parents and parent->children maps.
  const childrenOf: Record<string, string[]> = {};
  const parentOf: Record<string, string[]> = {};
  const nodes = new Set<string>(g.roots);
  for (const p of Object.keys(g.edges)) {
    nodes.add(p);
    for (const c of g.edges[p]) {
      nodes.add(c);
      (childrenOf[p] = childrenOf[p] || []).push(c);
      (parentOf[c] = parentOf[c] || []).push(p);
    }
  }

  // Depth = longest distance from any root. Memoized DFS with cycle guard.
  const depthCache: Record<string, number> = {};
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    if (depthCache[id] !== undefined) return depthCache[id];
    if (visiting.has(id)) return 0;          // cycle guard
    visiting.add(id);
    const parents = parentOf[id] ?? [];
    const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map(depthOf));
    visiting.delete(id);
    depthCache[id] = d;
    return d;
  };
  // Roots are always depth 0, even if referenced as a child (unlikely).
  for (const id of nodes) depthOf(id);

  // Group by depth.
  const byDepth: Record<number, string[]> = {};
  for (const id of nodes) {
    const d = depthCache[id] ?? 0;
    (byDepth[d] = byDepth[d] || []).push(id);
  }
  const depthKeys = Object.keys(byDepth).map(Number).sort((a, b) => a - b);
  const maxDepth = depthKeys.length ? depthKeys[depthKeys.length - 1] : 0;

  // Place each depth as a column (x), nodes stacked vertically (y).
  const layoutNodes: LayoutNode[] = [];
  const pos: Record<string, { x: number; y: number }> = {};
  for (const d of depthKeys) {
    const list = byDepth[d];
    const wx = PAD + d * (NODE_W + COL_GAP);
    let yy = PAD;
    for (const id of list) {
      layoutNodes.push({ id, x: wx, y: yy, w: NODE_W, h: NODE_H, depth: d, label: id });
      pos[id] = { x: wx, y: yy };
      yy += NODE_H + ROW_GAP;
    }
  }

  // Edges: parent -> child, drawn from parent right-center to child left-center.
  const edges: LayoutEdge[] = [];
  for (const p of Object.keys(childrenOf)) {
    if (!pos[p]) continue;
    for (const c of childrenOf[p]) {
      if (!pos[c]) continue;
      const x1 = pos[p].x + NODE_W;
      const y1 = pos[p].y + NODE_H / 2;
      const x2 = pos[c].x;
      const y2 = pos[c].y + NODE_H / 2;
      // Orthogonal-ish bezier: go right, then into the child's left-center.
      const mx = (x1 + x2) / 2;
      const path = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      edges.push({ from: p, to: c, path });
    }
  }

  const width = PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP;
  let maxH = 0;
  for (const d of depthKeys) { const n = byDepth[d].length; maxH = Math.max(maxH, PAD * 2 + n * NODE_H + (n - 1) * ROW_GAP); }
  return { nodes: layoutNodes, edges, width, height: maxH, depths: depthKeys.map(String) };
}
