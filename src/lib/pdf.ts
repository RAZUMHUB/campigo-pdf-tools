// The legacy build bundles the polyfills that keep pdf.js working on browsers a few versions old.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PageInfo, PdfSource, TextRun } from "@/editor/model";
import { MAX_PDF_BYTES } from "./files";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;
const docOptions = {
  cMapUrl: `${assets}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${assets}standard_fonts/`,
  wasmUrl: `${assets}wasm/`,
  iccUrl: `${assets}iccs/`,
};

export const MAX_JPG_EDGE = 4096;

export type PdfFile = PdfSource & { doc: PDFDocumentProxy };

export const closePdf = (file: PdfFile) => file.doc.loadingTask.destroy();

let seq = 0;

/** Opens a PDF for display. Throws an Error whose message is safe to show to the user. */
export async function openPdf(file: File): Promise<PdfFile> {
  if (file.size > MAX_PDF_BYTES) throw new Error(`“${file.name}” is larger than 100 MB.`);

  // pdf.js takes ownership of this buffer; the exporter re-reads the File when needed.
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...docOptions });
  try {
    const doc = await task.promise;
    const pages = await Promise.all(
      Array.from({ length: doc.numPages }, async (_, i): Promise<PageInfo> => {
        const page = await doc.getPage(i + 1);
        const { width, height } = page.getViewport({ scale: 1 });
        return { width, height, rotate: page.rotate, view: page.view as PageInfo["view"] };
      }),
    );
    return { id: `file${++seq}`, file, doc, pages };
  } catch (error) {
    await task.destroy();
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error(`“${file.name}” is password protected. Remove the password and try again.`);
    }
    throw new Error(`“${file.name}” could not be opened. It may be damaged or not a PDF.`);
  }
}

/** Opens every file or none: if any fails, the ones already opened are released. */
export async function openPdfs(files: File[]): Promise<PdfFile[]> {
  const results = await Promise.allSettled(files.map(openPdf));
  const opened = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) {
    await Promise.all(opened.map(closePdf));
    throw failed.reason;
  }
  return opened;
}

/** Editable runs of upright, horizontal text on a page. */
export async function loadRuns(doc: PDFDocumentProxy, index: number): Promise<TextRun[]> {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const { items, styles } = await page.getTextContent();

  const runs: TextRun[] = [];
  items.forEach((item, i) => {
    if (!("str" in item) || !item.str.trim()) return;
    const [a, b, , , e, f] = pdfjs.Util.transform(viewport.transform, item.transform);
    const fontSize = Math.hypot(a, b);
    if (fontSize < 1 || a <= 0 || Math.abs(b) > 0.01 * fontSize) return;
    runs.push({
      key: String(i),
      str: item.str,
      x: e,
      y: f - 0.9 * fontSize,
      w: item.width,
      h: 1.12 * fontSize,
      baseline: f,
      fontSize,
      fontFamily: styles[item.fontName]?.fontFamily,
    });
  });
  return runs;
}

/** Renders every page of a PDF to a JPEG. */
export async function renderJpgs(
  pdf: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> {
  const doc = await pdfjs.getDocument({ data: pdf, ...docOptions }).promise;
  try {
    const blobs: Blob[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, MAX_JPG_EDGE / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport, background: "#fff" }).promise;
      blobs.push(
        await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image."))), "image/jpeg", 0.92),
        ),
      );
      canvas.width = canvas.height = 0;
      page.cleanup();
      onProgress?.(i, doc.numPages);
    }
    return blobs;
  } finally {
    await doc.loadingTask.destroy();
  }
}
