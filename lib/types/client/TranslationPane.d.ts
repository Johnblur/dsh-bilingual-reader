import type { SelectionContext } from './hooks.js';
export interface TranslationPaneProps {
    last?: SelectionContext;
    result?: string;
    busy?: boolean;
    error?: string;
    onCopy?: () => void;
}
export declare function TranslationPane(props: TranslationPaneProps): JSX.Element;
