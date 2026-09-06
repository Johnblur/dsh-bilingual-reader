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
export declare function layoutDomainGraph(g: DomainGraph): LayoutResult;
