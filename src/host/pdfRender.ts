// host/pdfRender.ts — render a PDF page to a PNG + extract per-text-item screen coords.
// Uses pdf.js's SAME viewport (same scale) for both the page image and the text
// coordinates, so the client's text layer aligns exactly with the rendered page.
import { promises as fs } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface TextItem { x: number; y: number; fontSize: number; text: string }
export interface RenderedPage {
  imageDataUrl: string;
  width: number;
  height: number;
  items: TextItem[];
}

// Compose two 2D affine transforms (pdf.js Util.transform).
function transform(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export async function renderPage(file: string, pageNum: number, scale: number): Promise<RenderedPage> {
  const data = new Uint8Array(await fs.readFile(file));
  const doc = await pdfjs.getDocument({ data }).promise;
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const c2d = canvas.getContext('2d');
  await page.render({ canvasContext: c2d as unknown as CanvasRenderingContext2D, viewport }).promise;
  const imageDataUrl = 'data:image/png;base64,' + canvas.toBuffer('image/png').toString('base64');

  const tc = await page.getTextContent();
  const items: TextItem[] = tc.items
    .filter((i: any) => i && typeof i.str === 'string' && i.str.length > 0)
    .map((i: any) => {
      const t = transform(viewport.transform as number[], i.transform as number[]);
      return {
        x: Math.round(t[4]),
        y: Math.round(t[5]),
        fontSize: Math.round((i.height as number) || 10),
        text: i.str,
      };
    });

  return { imageDataUrl, width: viewport.width, height: viewport.height, items };
}
