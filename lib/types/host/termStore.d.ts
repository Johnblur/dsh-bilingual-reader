import type { DomainGraph, TermEntry } from '../shared/domain.js';
export interface TermStore {
    /** Path to the asset directory (the plugin's own folder under the profile). */
    dir: string;
    graph: DomainGraph;
    terms: TermEntry[];
    load(): Promise<void>;
    saveGraph(): Promise<void>;
    saveTerms(): Promise<void>;
}
export declare function createTermStore(baseDir: string): TermStore;
