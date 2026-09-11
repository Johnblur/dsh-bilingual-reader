export interface ClipboardWatcher {
    /** Latest clipboard text seen ('' until the first change). */
    read(): string;
    /** Whether the watcher process is alive. */
    available(): boolean;
    dispose(): void;
}
export declare function startClipboardWatcher(): ClipboardWatcher;
