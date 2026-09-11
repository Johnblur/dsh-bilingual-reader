export interface ClipboardDebug {
    available: boolean;
    lines: number;
    bytes: number;
    /** Whether the temp-file mirror has produced usable content. */
    fileOk: boolean;
    /** Which read path the helper settled on (from its stderr banner). */
    mode: string;
    /** Last stderr tail from the watcher process. */
    err: string;
}
export interface ClipboardWatcher {
    /** Latest clipboard text seen ('' until the first change). */
    read(): string;
    /** Whether the watcher process is alive. */
    available(): boolean;
    /**
     * Snapshot for the client's in-tab failure message. The plugin's routes are
     * fenced to the Electron renderer, so the user cannot inspect them from a
     * browser; surfacing the reason in the tab is the only practical channel.
     */
    debug(): ClipboardDebug;
    dispose(): void;
}
export declare function startClipboardWatcher(): ClipboardWatcher;
