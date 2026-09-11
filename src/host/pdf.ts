// host/pdf.ts — PDF text extraction via pdfjs-dist.
// pdfjs's getTextContent() returns items in content-stream order, which IS the
// reading order, so we concatenate them directly. The old `reflow` heuristic
// cut every page by its median x into two "columns"; for single-column / abstract
// pages that scrambled the sentence order (a full sentence became non-contiguous
// and letter-sequence matching failed), and even on real two-column pages it did
// not reliably restore order. Removing it keeps fullText in true reading order,
// which matches the copied selection correctly.
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { DocumentText } from '../types.js';
// Use pdfjs's LEGACY build: it is the one pdfjs documents for non-browser hosts,
// and it polyfills the DOM globals (DOMMatrix, Path2D) the modern build assumes.
// Text output is identical (verified on every PDF in the library). The
// browser-facing /pdf.mjs and /pdf.worker.mjs routes in index.ts must keep
// serving the MODERN build — only this Node-side import changes.
// eslint-disable-next-line import/no-unresolved
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdfjs decides whether it is on Node with:
//   !(process.versions.electron && process.type && process.type !== 'browser')
// The DSH >= 2.0.9 host runs inside an Electron utilityProcess, where
// process.type === 'utility', so pdfjs concludes it is in a BROWSER. It then
// reads PDFWorker.workerSrc — which THROWS when unset, and it does so BEFORE the
// surrounding try/catch can fall back to the fake worker, so every extraction
// failed with 'No "GlobalWorkerOptions.workerSrc" specified.'. Point it at the
// matching worker file as an absolute file URL: the fake worker is loaded with a
// dynamic import, so a bare specifier or a cwd-relative path would not resolve.
GlobalWorkerOptions.workerSrc = pathToFileURL(
  createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
).href;

interface TextItem { str: string; transform: number[]; width: number; height: number }

export async function extractPdf(filePath: string): Promise<DocumentText> {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await getDocument({ data }).promise;
  let fullText = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as unknown as TextItem[]) {
      const str = (it as unknown as { str: string }).str;
      if (!str) continue;
      fullText += str;
      // Insert a space between adjacent items that don't already end/start with
      // whitespace, so words on the same line don't fuse (pdfjs splits text into
      // items at style/position boundaries, and joining them bare would merge
      // "the" + "model" into "themodel"). We only add a space when the previous
      // char isn't already whitespace, keeping real spaces intact.
      if (!fullText.endsWith(' ') && !fullText.endsWith('\n')) fullText += ' ';
    }
    fullText += '\n';
  }

  fullText = fullText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const paragraphs = splitParagraphs(fullText);

  return { file: filePath, fullText, source: 'pdf', paragraphs };
}

function splitParagraphs(fullText: string): Array<{ start: number; end: number }> {
  const paragraphs: Array<{ start: number; end: number }> = [];
  const lines = fullText.split('\n');
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      paragraphs.push({ start, end: i });
      start = i + 1;
    }
  }
  paragraphs.push({ start, end: lines.length });
  return paragraphs;
}
