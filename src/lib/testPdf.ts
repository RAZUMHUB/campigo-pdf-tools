/** Test helpers: build PDFs with pdf-lib and extract text with PDF.js. */
import fs from "node:fs";
import { PDFDocument, StandardFonts, PDFName, decodePDFRawStream, PDFRawStream, PDFArray } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export const fontFile = (name: string) => fs.readFileSync(`node_modules/@fontsource/${name}`);
export const NOTO = () => fontFile("noto-sans/files/noto-sans-latin-400-normal.woff");
export const NOTO_BOLD = () => fontFile("noto-sans/files/noto-sans-latin-700-normal.woff");
export const NOTO_LATIN_EXT = () => fontFile("noto-sans/files/noto-sans-latin-ext-400-normal.woff");
export const NOTO_DEVA = () => fontFile("noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff");
export const NOTO_DEVA_BOLD = () => fontFile("noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff");

export async function newDoc() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  return doc;
}

export const reload = async (bytes: Uint8Array) => PDFDocument.load(bytes);

/** Raw decoded content stream of page `index`, as latin1 text. */
export function contentText(doc: PDFDocument, index = 0) {
  const node = doc.getPage(index).node;
  const raw = node.get(PDFName.of("Contents"));
  const resolved = doc.context.lookup(raw);
  const list = resolved instanceof PDFArray ? resolved.asArray().map((r) => doc.context.lookup(r)) : [resolved];
  return list.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString("latin1")).join("\n");
}

/** Every object in the saved file, decoded, concatenated: used to prove old text is really gone. */
export function allStreamsText(doc: PDFDocument) {
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        out += Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1") + "\n";
      } catch { /* binary */ }
    }
  }
  return out;
}

export async function extract(bytes: Uint8Array, pageNo = 1) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(pageNo);
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((i: any) => i.str !== "")
    .map((i: any) => ({ str: i.str as string, x: i.transform[4] as number, y: i.transform[5] as number }));
  await task.destroy();
  return items;
}

export { StandardFonts };
