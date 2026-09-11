export interface ClipboardDebug {
    available: boolean;
    lines: number;
    bytes: number;
    /** Whether the temp-file mirror has produced usable content. */
    fileOk: boolean;
    /** Last stderr tail from the watcher process (diagnosis). */
    err: string;
    /** Temp file used by the mirror channel. */
    file: string;
}
export interface ClipboardWatcher {
    /** Latest clipboard text seen ('' until the first change). */
    read(): string;
    /** Whether the watcher process is alive. */
    available(): boolean;
    debug(): ClipboardDebug;
    dispose(): void;
}
export declare function startClipboardWatcher(): ClipboardWatcher;
