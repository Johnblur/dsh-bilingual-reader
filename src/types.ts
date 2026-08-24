// Shared types between host and client.

/** One chunk of a document, section-aware. */
export interface DocChunk {
  /** Stable id (e.g. section index + hash). */
  id: string;
  /** Section level (0 = doc title, 1 = #, ...). */
  level: number;
  /** Section heading (may be empty for intro). */
  heading: string;
  /** Raw text of this chunk. */
  text: string;
  /** Optional source text used to seed context (arXiv HTML if available). */
  sourceText?: string;
}

/** Extracted text of one document, before chunking. */
export interface DocumentText {
  /** Absolute path of the source file. */
  file: string;
  /** Full raw text in reading order. */
  fullText: string;
  /** How it was obtained: 'pdf' | 'arxiv-text'. */
  source: 'pdf' | 'arxiv-text';
  /** Paragraph boundaries (offsets) for line/paragraph-aware selection context. */
  paragraphs: Array<{ start: number; end: number }>;
}

/** A translation request built by the client, executed by host in isolation. */
export interface TranslateRequest {
  kind: 'full-text' | 'selection';
  /** For selection: the highlighted text. */
  selection?: string;
  /** For selection: the surrounding context window text. */
  context?: string;
  /** For full-text: which chunk ids to translate. */
  chunkIds?: string[];
  /** Term/glossary map to keep terminology consistent. */
  glossary?: Record<string, string>;
  target?: string;
  /** Optional override; falls back to the per-mode default (see model.ts). */
  provider?: string;
  model?: string;
}

/** Streamed translation events from host -> client. */
export type TranslateEvent =
  | { type: 'start'; requestId: string }
  | { type: 'delta'; requestId: string; text: string }
  | { type: 'done'; requestId: string; full: string }
  | { type: 'error'; requestId: string; message: string };
