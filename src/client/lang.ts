// src/client/lang.ts — language model for multi-language mutual translation.
// Pure logic, no UI. Holds the built-in preset + user-custom languages, a
// zero-cost heuristic script detector (zh/ja/ko are unambiguous by character
// class; Latin text is only a *candidate*), and a predicate for when to
// upgrade to an LLM classify (multiple same-script languages, or a low
// confidence read).

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
export const LANGS: Lang[] = [
  { code: 'zh', name: '中文', native: '中文（简体）', prompt: 'Chinese (Simplified)', script: 'cjk' },
  { code: 'en', name: '英语', native: 'English', prompt: 'English', script: 'latin' },
  { code: 'ja', name: '日语', native: '日本語', prompt: 'Japanese', script: 'kana' },
  { code: 'ko', name: '韩语', native: '한국어', prompt: 'Korean', script: 'hangul' },
];

/**
 * The "auto" pseudo-entry shown as the source-language placeholder. Its code
 * is never sent as a real source; it signals the pipeline to detect.
 */
export const AUTO_DETECT: Lang = { code: 'auto', name: '自动识别', native: 'Auto-detect', prompt: 'auto', script: 'other' };

/** LocalStorage keys (namespaced, one blob per concern). */
export const LS_CUSTOM = 'dsh-bl.customLangs';
export const LS_SOURCE = 'dsh-bl.source';
export const LS_TARGET = 'dsh-bl.target';
export const LS_CONTEXT_LEN = 'dsh-bl.contextLen';

export function loadLangBlob<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === '') return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

export function saveLangBlob<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore quota/serialization */ }
}

/** Default target language, following the UI language (zh UI → 中文, else English). */
export function defaultTarget(isZh: boolean): string {
  return isZh ? 'zh' : 'en';
}

/** Default source: auto-detect unless the user pinned one. */
export const defaultSource = (): string => AUTO_DETECT.code;

/** The initial languages from localStorage, with sane defaults. */
export function initialCustom(): Lang[] {
  const c = loadLangBlob<Lang[]>(LS_CUSTOM, []);
  return Array.isArray(c) ? c.filter((x) => x && typeof x.code === 'string') : [];
}

export function initialSource(): string {
  const s = loadLangBlob<string>(LS_SOURCE, AUTO_DETECT.code);
  return typeof s === 'string' && s ? s : AUTO_DETECT.code;
}

export function initialTarget(isZh: boolean): string {
  const t = loadLangBlob<string>(LS_TARGET, isZh ? 'zh' : 'en');
  return typeof t === 'string' && t ? t : (isZh ? 'zh' : 'en');
}

export function initialContextLen(): number {
  const n = loadLangBlob<number>(LS_CONTEXT_LEN, 250);
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(800, Math.round(n))) : 250;
}

/** The full ordered language set: preset + user customs (customs appended). */
export function allLangs(customs: Lang[]): Lang[] {
  return customs.length === 0 ? LANGS : [...LANGS, ...customs];
}

/** The localizer: pick the language code by an ISO (or heuristic) result. */
export function resolveLangCode(code: string, customs: Lang[]): string {
  const all = allLangs(customs);
  const found = all.find((l) => l.code.toLowerCase() === String(code).toLowerCase());
  return found ? found.code : AUTO_DETECT.code;
}

/** The friendly label for a code (used for the "detected as" line). */
export function langName(code: string, customs: Lang[]): string {
  const all = allLangs(customs);
  const found = all.find((l) => l.code.toLowerCase() === String(code).toLowerCase());
  if (found) return `${found.name}（${found.native}）`;
  return code;
}

// ── Heuristic script detection ────────────────────────────────────────────
// Count distinct character-class runs in a sample. Script classes that don't
// overlap between languages give a near-certain answer for zh/ja/ko; Latin
// (English/other European) is only a candidate because many Latin languages
// share the class and cannot be told apart without an LLM.

const RE = {
  han: /[\u4e00-\u9fff\u3400-\u4dbf]/g,      // CJK ideographs
  kana: /[\u3041-\u3096\u30a0-\u30ff]/g,     // hiragana + katakana
  hangul: /[\uac00-\ud7af\u1100-\u11ff]/g,   // hangul syllables + jamo
  cyrillic: /[\u0400-\u04ff]/g,
  arabic: /[\u0600-\u06ff\u0750-\u077f]/g,
  thai: /[\u0e00-\u0e7f]/g,
  devanagari: /[\u0900-\u097f]/g,
  latin: /[A-Za-z\u00c0-\u024f]/g,           // latin + latin-1 supplements
};

function count(s: string, re: RegExp): number {
  const m = s.match(re);
  return m ? m.length : 0;
}

/** Decide the script group from simple counts. Returns 'other' when unclear. */
export function scriptOf(text: string): ScriptGroup {
  const han = count(text, RE.han);
  const kana = count(text, RE.kana);
  const hangul = count(text, RE.hangul);
  const cyr = count(text, RE.cyrillic);
  const arab = count(text, RE.arabic);
  const thai = count(text, RE.thai);
  const dev = count(text, RE.devanagari);
  const latin = count(text, RE.latin);
  // A language is present when its script dominates the visual mass.
  if (hangul > 0 && hangul >= Math.max(1, han * 0.2)) return 'hangul';
  if (kana > 0 && kana >= 2) return 'kana';
  if (han > 0 && han >= Math.max(1, kana * 0.5)) return 'cjk';
  if (cyr > 0 && cyr >= latin * 0.3) return 'cyrillic';
  if (arab > 0 && arab >= latin * 0.3) return 'arabic';
  if (thai > 0 && thai >= latin * 0.3) return 'thai';
  if (dev > 0 && dev >= latin * 0.3) return 'devanagari';
  if (latin > 0) return 'latin';
  return 'other';
}

/** Heuristic language guess. Deterministic and free; only reliable for the
 *  script-distinct classes. Latin returns code 'en' but with a low confidence
 *  flag (it could be any Latin-script language → upgrade to LLM). */
export interface DetectResult { lang: string; script: ScriptGroup; confidence: 'high' | 'low' }

export function detectByScript(text: string, preset: Lang[]): DetectResult {
  if (!text || !text.trim()) return { lang: 'en', script: 'other', confidence: 'low' };
  const script = scriptOf(text);
  // Map the detected script onto the best matching built-in language.
  const match = preset.filter((l) => l.script === script);
  if (script === 'cjk') return { lang: 'zh', script, confidence: 'high' };
  if (script === 'kana') return { lang: 'ja', script, confidence: 'high' };
  if (script === 'hangul') return { lang: 'ko', script, confidence: 'high' };
  if (script === 'cyrillic') return { lang: 'ru' in match ? 'ru' : (match[0]?.code ?? 'en'), script, confidence: 'high' };
  if (script === 'arabic') return { lang: match[0]?.code ?? 'ar', script, confidence: 'high' };
  if (script === 'thai') return { lang: match[0]?.code ?? 'th', script, confidence: 'high' };
  if (script === 'devanagari') return { lang: match[0]?.code ?? 'hi', script, confidence: 'high' };
  // Latin: only a candidate. If exactly one Latin language is in the set, take
  // it; else low confidence → upgrade to LLM classify.
  const latinLangs = preset.filter((l) => l.script === 'latin');
  if (latinLangs.length === 1) return { lang: latinLangs[0].code, script, confidence: 'high' };
  return { lang: 'en', script, confidence: 'low' };
}

/** Whether a heuristic read is ambiguous enough to require an LLM classify.
 *  Two triggers: (a) the active set has ≥2 languages of one script (Latin eg),
 *  (b) the heuristic itself came back low-confidence. */
export function needsLlmDetect(result: DetectResult, preset: Lang[]): boolean {
  if (result.confidence === 'low') return true;
  const groups = new Map<string, number>();
  for (const l of preset) groups.set(l.script, (groups.get(l.script) ?? 0) + 1);
  return (groups.get(result.script) ?? 0) >= 2;
}
