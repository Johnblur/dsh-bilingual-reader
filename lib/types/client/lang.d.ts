export type ScriptGroup = 'cjk' | 'kana' | 'hangul' | 'latin' | 'cyrillic' | 'arabic' | 'thai' | 'devanagari' | 'other';
export interface Lang {
    /** Stable state key (ISO 639-1 where known; custom codes are user-supplied). */
    code: string;
    /** Short Chinese display name (UI). */
    name: string;
    /** Native endonym (for the model + user recognition). */
    native: string;
    /** The name handed to the LLM in the prompt (what the model most reliably
     *  recognizes, e.g. "Chinese (Simplified)", "Japanese", "Korean"). */
    prompt: string;
    /** Character-class group the heuristic detector maps this language to. */
    script: ScriptGroup;
    /** Whether this entry is user-added (kept in localStorage). */
    custom?: boolean;
}
/** Built-in preset (the four the user asked for). */
export declare const LANGS: Lang[];
/**
 * The "auto" pseudo-entry shown as the source-language placeholder. Its code
 * is never sent as a real source; it signals the pipeline to detect.
 */
export declare const AUTO_DETECT: Lang;
/** LocalStorage keys (namespaced, one blob per concern). */
export declare const LS_CUSTOM = "dsh-bl.customLangs";
export declare const LS_SOURCE = "dsh-bl.source";
export declare const LS_TARGET = "dsh-bl.target";
export declare const LS_CONTEXT_LEN = "dsh-bl.contextLen";
export declare function loadLangBlob<T>(key: string, fallback: T): T;
export declare function saveLangBlob<T>(key: string, value: T): void;
/** Default target language, following the UI language (zh UI → 中文, else English). */
export declare function defaultTarget(isZh: boolean): string;
/** Default source: auto-detect unless the user pinned one. */
export declare const defaultSource: () => string;
/** The initial languages from localStorage, with sane defaults. */
export declare function initialCustom(): Lang[];
export declare function initialSource(): string;
export declare function initialTarget(isZh: boolean): string;
export declare function initialContextLen(): number;
/** The full ordered language set: preset + user customs (customs appended). */
export declare function allLangs(customs: Lang[]): Lang[];
/** The localizer: pick the language code by an ISO (or heuristic) result. */
export declare function resolveLangCode(code: string, customs: Lang[]): string;
/** The friendly label for a code (used for the "detected as" line). */
export declare function langName(code: string, customs: Lang[]): string;
/** Decide the script group from simple counts. Returns 'other' when unclear. */
export declare function scriptOf(text: string): ScriptGroup;
/** Heuristic language guess. Deterministic and free; only reliable for the
 *  script-distinct classes. Latin returns code 'en' but with a low confidence
 *  flag (it could be any Latin-script language → upgrade to LLM). */
export interface DetectResult {
    lang: string;
    script: ScriptGroup;
    confidence: 'high' | 'low';
}
export declare function detectByScript(text: string, preset: Lang[]): DetectResult;
/** Whether a heuristic read is ambiguous enough to require an LLM classify.
 *  Two triggers: (a) the active set has ≥2 languages of one script (Latin eg),
 *  (b) the heuristic itself came back low-confidence. */
export declare function needsLlmDetect(result: DetectResult, preset: Lang[]): boolean;
