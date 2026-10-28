import { BlendMode, PDFDocument, degrees, rgb, type PDFImage } from "pdf-lib";
import {
  BASELINE,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_OPACITY,
  LINE_HEIGHT,
  pageKey,
  toUserSpace,
  type Annotation,
  type Edits,
  type PageInfo,
  type PdfSource,
  type Rect,
} from "@/editor/model";
import { replaceInPage, type ReplaceRequest, type ReplaceResult } from "./pdfText";
import { TextPainter, WIN_ANSI, styleFromFamily, type FallbackFontLoader } from "./textDraw";

export { unsupportedAfterFallback, needsFallbackFont, type FallbackFontLoader } from "./textDraw";

/** True if `text` contains characters the *standard* PDF fonts cannot represent (see `unsupportedAfterFallback`). */
export const hasUnsupportedChars = (text: string) =>
  Array.from(text).some((ch) => ch !== "\n" && ch !== "\t" && !WIN_ANSI.has(ch));

const hex = (value: string) => {
  const n = parseInt(value.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

const dataUrlToBytes = (url: string) =>
  Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));

function userRect(info: PageInfo, r: Rect) {
  const [x1, y1] = toUserSpace(info, r.x, r.y);
  const [x2, y2] = toUserSpace(info, r.x + r.w, r.y + r.h);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

/** What happened to one edit of existing text. */
export interface EditReport {
  id: string;
  /**
   * in-place  – the original string was rewritten with the original font (best fidelity)
   * redrawn   – the original text was removed; replacement drawn with a substitute font
   * overlay   – the original text could NOT be located; a cover + new text were drawn on top (old text remains underneath)
   */
  mode: "in-place" | "redrawn" | "overlay";
  reason?: string;
}

export interface ExportOptions {
  /** Supplies Unicode fallback fonts (e.g. Noto Sans + Noto Sans Devanagari). Without it, non-WinAnsi text becomes "?". */
  fallbackFonts?: FallbackFontLoader;
  /** Called once per edit of existing text, and once with `missing` characters if any could not be drawn. */
  onReport?: (report: EditReport) => void;
  onMissingGlyphs?: (chars: string[]) => void;
}

/** Applies all edits and returns the resulting PDF. Multiple sources are merged in order. */
export async function exportPdf(
  files: PdfSource[],
  edits: Edits,
  options: ExportOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const sources = await Promise.all(
    files.map(async (f) => PDFDocument.load(await f.file.arrayBuffer(), { updateMetadata: false })),
  );

  // A single file is edited in place so metadata, bookmarks and the like survive.
  const out = sources.length === 1 ? sources[0] : await PDFDocument.create();
  const pages = sources.length === 1 ? out.getPages() : [];
  if (sources.length > 1) {
    for (const src of sources) {
      for (const page of await out.copyPages(src, src.getPageIndices())) pages.push(out.addPage(page));
    }
  }

  const painter = new TextPainter(out, options.fallbackFonts);
  const images = new Map<string, PDFImage>();
  const byPage = new Map<string, Annotation[]>();
  for (const a of edits.annotations) {
    const key = pageKey(a.fileId, a.page);
    byPage.set(key, [...(byPage.get(key) ?? []), a]);
  }

  let n = 0;
  for (const file of files) {
    for (const [index, info] of file.pages.entries()) {
      const page = pages[n++];
      const key = pageKey(file.id, index);
      const annotations = byPage.get(key) ?? [];

      // 1. Edits of existing text first, while the page's content stream is still the original.
      const requests: ReplaceRequest[] = [];
      for (const a of annotations) {
        if (a.type !== "text" || !a.cover?.source) continue;
        const [x, y] = toUserSpace(info, a.cover.source.x, a.cover.source.baseline);
        requests.push({ id: a.id, x, y, text: a.cover.source.text, replacement: a.text });
      }
      const results = new Map<string, ReplaceResult>(replaceInPage(out, page, requests).map((r) => [r.id, r]));

      const turn = edits.rotations[key] ?? 0;
      if (turn) page.setRotation(degrees((info.rotate + turn) % 360));

      const rotate = degrees(info.rotate);
      for (const a of annotations) {
        if (a.type === "highlight") {
          page.drawRectangle({
            ...userRect(info, a),
            color: hex(HIGHLIGHT_COLOR),
            opacity: HIGHLIGHT_OPACITY,
            blendMode: BlendMode.Multiply,
          });
        } else if (a.type === "image") {
          let image = images.get(a.src);
          if (!image) {
            const bytes = dataUrlToBytes(a.src);
            image = a.mime === "image/png" ? await out.embedPng(bytes) : await out.embedJpg(bytes);
            images.set(a.src, image);
          }
          const [x, y] = toUserSpace(info, a.x, a.y + a.h);
          page.drawImage(image, { x, y, width: a.w, height: a.h, rotate });
        } else {
          const result = results.get(a.id);
          if (result?.status === "in-place") {
            options.onReport?.({ id: a.id, mode: "in-place" });
            continue; // the page content itself already carries the new text
          }
          let style = styleFromFamily(a.fontFamily);
          let color = hex(a.color);
          if (result?.status === "removed") {
            // The original glyphs are gone from the content stream, so no cover is needed.
            style = result.style;
            color = rgb(...result.fill); // the exact fill the original text was drawn with
            options.onReport?.({ id: a.id, mode: "redrawn", reason: result.reason });
          } else if (a.cover) {
            // Legacy overlay: could not find the original text (or there is no source to look for).
            page.drawRectangle({ ...userRect(info, a.cover), color: hex(a.cover.color) });
            options.onReport?.({
              id: a.id,
              mode: "overlay",
              reason: result?.status === "not-found" ? result.reason : "the edit does not map to a single text run",
            });
          }
          for (const [i, line] of a.text.split(/\r?\n/).entries()) {
            const [x, y] = toUserSpace(info, a.x, a.y + (BASELINE + LINE_HEIGHT * i) * a.fontSize);
            await painter.drawLine(page, line, { x, y, size: a.fontSize, color, rotate, style });
          }
        }
      }
    }
  }

  if (painter.missing.size) options.onMissingGlyphs?.([...painter.missing]);

  // pdf-lib always allocates a plain ArrayBuffer; TypeScript just can't see that.
  return (await out.save({
    useObjectStreams: false,
    addDefaultPage: false,
  })) as Uint8Array<ArrayBuffer>;
}
