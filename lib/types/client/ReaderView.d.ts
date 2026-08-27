import type { DocChunk } from '../types.js';
export interface ReaderViewProps {
    chunks: DocChunk[];
    translations: Record<string, string>;
    show: 'original' | 'translation' | 'both';
    busy?: Record<string, boolean>;
    onSelect?: (text: string) => void;
}
export declare function ReaderView(props: ReaderViewProps): JSX.Element;
