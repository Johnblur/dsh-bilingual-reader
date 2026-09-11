export interface ClipboardDebug {
    available: boolean;
    lines: number;
    bytes: number;
    /** Whether the temp-file mirror has produced usable content. */
    fileOk: boolean;
    /** How many times the HTTP route asked for the clipboard. */
    polls: number;
    /** Which read path the helper settled on (from its stderr banner). */
    mode: string;
    /** Last stderr tail from the watcher process (diagnosis). */
    err: string;
    /** Temp file used by the mirror channel. */
    file: string;
    /** Where this diagnostic snapshot is mirrored for out-of-band inspection. */
    status: string;
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
