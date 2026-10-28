import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { exportPdf, type EditReport } from "./export";
import { toUserSpace, type Annotation, type PageInfo, type PdfSource } from "@/editor/model";
import { NOTO, NOTO_BOLD, NOTO_DEVA, NOTO_DEVA_BOLD, NOTO_LATIN_EXT, allStreamsText, contentText, extract, newDoc, reload } from "./testPdf";

const fallbackFonts = async (bold: boolean) => (bold ? [NOTO_BOLD(), NOTO_DEVA_BOLD()] : [NOTO(), NOTO_LATIN_EXT(), NOTO_DEVA()]);

const source = (id: string, bytes: Uint8Array, pages: PageInfo[]): PdfSource => ({
  id,
  file: new File([bytes as BlobPart], `${id}.pdf`, { type: "application/pdf" }),
  pages,
});

/**
 * Editor (viewport) coordinates of a PDF user-space point, found by inverting the app's own toUserSpace.
 * toUserSpace is affine, so three probes determine the inverse; this keeps the rotated-page test independent
 * of any assumption about how a page's /Rotate maps to the viewport.
 */
function toEditorSpace(info: PageInfo, ux: number, uy: number): [number, number] {
  const [ox, oy] = toUserSpace(info, 0, 0);
  const [ax, ay] = toUserSpace(info, 1, 0);
  const [bx, by] = toUserSpace(info, 0, 1);
  const [a, b, c, d] = [ax - ox, bx - ox, ay - oy, by - oy];
  const det = a * d - b * c;
  const [dx, dy] = [ux - ox, uy - oy];
  return [(d * dx - b * dy) / det, (a * dy - c * dx) / det];
}

/** A run edit exactly as Editor.commitText creates it. Editor coords: top-left origin, baseline at y. */
const runEdit = (o: { fileId?: string; page?: number; x: number; baseline: number; fontSize: number; original: string; text: string }): Annotation => ({
  id: `a-${Math.random().toString(36).slice(2)}`,
  type: "text",
  fileId: o.fileId ?? "f1",
  page: o.page ?? 0,
  x: o.x,
  y: o.baseline - 0.8 * o.fontSize,
  fontSize: o.fontSize,
  color: "#000000",
  text: o.text,
  cover: {
    x: o.x, y: o.baseline - o.fontSize, w: 100, h: o.fontSize * 1.2, color: "#ffeeaa", original: o.original, runKey: "k",
    source: { x: o.x, baseline: o.baseline, text: o.original },
  },
});

async function helveticaDoc(lines: Array<[string, number, number]>, size = 14) {
  const doc = await newDoc();
  const page = doc.addPage([400, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [t, x, y] of lines) page.drawText(t, { x, y, size, font });
  return doc.save({ useObjectStreams: false });
}

const run = async (bytes: Uint8Array, anns: Annotation[], info = { width: 400, height: 300, rotate: 0, view: [0, 0, 400, 300] } as PageInfo) => {
  const reports: EditReport[] = [];
  const missing: string[][] = [];
  const out = await exportPdf([source("f1", bytes, [info])], { annotations: anns, rotations: {} }, {
    fallbackFonts,
    onReport: (r) => reports.push(r),
    onMissingGlyphs: (c) => missing.push(c),
  });
  return { out, reports, missing };
};

describe("exportPdf: existing text edits", () => {
  it("edits in place: no cover rectangle, old text gone from the file, other text untouched", async () => {
    const bytes = await helveticaDoc([["Contact: +91 98765 43210", 50, 200], ["Second line", 50, 150]]);
    // Editor baseline (top-left origin) for user y=200 on a 300pt page is 100.
    const { out, reports } = await run(bytes, [runEdit({ x: 50, baseline: 100, fontSize: 14, original: "Contact: +91 98765 43210", text: "Contact: +91 11111 22222" })]);
    expect(reports).toEqual([{ id: expect.any(String), mode: "in-place" }]);
    expect((await extract(out)).map((i) => i.str)).toEqual(["Contact: +91 11111 22222", "Second line"]);
    const reloaded = await reload(out);
    expect(contentText(reloaded)).not.toMatch(/^f$/m); // pdf-lib fills a cover with "... h f"
    expect(allStreamsText(reloaded)).not.toContain("39383736"); // old digits' hex
  });

  it("falls back to a visible overlay and says so when the original text cannot be located", async () => {
    const bytes = await helveticaDoc([["Hello", 50, 200]]);
    const { out, reports } = await run(bytes, [runEdit({ x: 50, baseline: 100, fontSize: 14, original: "Not on the page", text: "X" })]);
    expect(reports[0]).toMatchObject({ mode: "overlay", reason: expect.stringContaining("not found") });
    expect(contentText(await reload(out))).toMatch(/^f$/m);
  });

  it("draws Hindi through the Unicode fallback after removing the original", async () => {
    const bytes = await helveticaDoc([["Name: Prince", 50, 200], ["Keep me", 50, 150]]);
    const { out, reports, missing } = await run(bytes, [runEdit({ x: 50, baseline: 100, fontSize: 14, original: "Name: Prince", text: "नाम: प्रिंस" })]);
    expect(reports[0].mode).toBe("redrawn");
    expect(missing).toEqual([]);
    const text = (await extract(out)).map((i) => i.str).join("");
    expect(text).toContain("Keep me");
    expect(text).not.toContain("Prince");
    expect(text.normalize("NFC")).toContain("नाम");
  });

  it("reports characters no font can draw instead of failing silently", async () => {
    const bytes = await helveticaDoc([["Hello", 50, 200]]);
    const { missing, out } = await run(bytes, [runEdit({ x: 50, baseline: 100, fontSize: 14, original: "Hello", text: "日本" })]);
    expect(missing.flat().sort()).toEqual(["日", "本"]);
    expect((await extract(out)).map((i) => i.str).join("")).toContain("??");
  });

  it("handles multi-line replacement text by drawing each line after removing the original", async () => {
    const bytes = await helveticaDoc([["One line", 50, 200]]);
    const { out, reports } = await run(bytes, [runEdit({ x: 50, baseline: 100, fontSize: 14, original: "One line", text: "First\nSecond" })]);
    expect(reports[0].mode).toBe("redrawn");
    const text = (await extract(out)).map((i) => i.str);
    expect(text).toEqual(expect.arrayContaining(["First", "Second"]));
    expect(text).not.toContain("One line");
  });

  it("edits a rotated page (/Rotate 90) at the right place", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    page.setRotation(degrees(90));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Rotated text", { x: 60, y: 40, size: 14, font, rotate: degrees(90) });
    page.drawText("Other", { x: 60, y: 200, size: 14, font, rotate: degrees(90) });
    const bytes = await doc.save({ useObjectStreams: false });
    // The viewport of a 400x300 page with /Rotate 90 is 300x400. Editor coordinates of the run's start (user 60,40):
    const info = { width: 300, height: 400, rotate: 90, view: [0, 0, 400, 300] } as PageInfo;
    const [ex, ey] = toEditorSpace(info, 60, 40);
    const { out, reports } = await run(bytes, [runEdit({ x: ex, baseline: ey, fontSize: 14, original: "Rotated text", text: "Edited" })], info);
    expect(reports[0].mode).toBe("in-place");
    const text = (await extract(out)).map((i) => i.str);
    expect(text).toEqual(expect.arrayContaining(["Edited", "Other"]));
    expect(text).not.toContain("Rotated text");
    expect((await reload(out)).getPage(0).getRotation().angle).toBe(90);
  });

  it("edits a page of the second file when merging", async () => {
    const a = await helveticaDoc([["First file", 50, 200]]);
    const b = await helveticaDoc([["Second file", 50, 200]]);
    const info = { width: 400, height: 300, rotate: 0, view: [0, 0, 400, 300] } as PageInfo;
    const out = await exportPdf(
      [source("f1", a, [info]), source("f2", b, [info])],
      { annotations: [runEdit({ fileId: "f2", x: 50, baseline: 100, fontSize: 14, original: "Second file", text: "Changed" })], rotations: {} },
    );
    expect((await extract(out, 1)).map((i) => i.str)).toEqual(["First file"]);
    expect((await extract(out, 2)).map((i) => i.str)).toEqual(["Changed"]);
  });

  it("keeps preserving metadata and page count for single-file edits", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Résumé");
    doc.addPage([400, 300]).drawText("Hi", { x: 50, y: 200, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
    const bytes = await doc.save({ useObjectStreams: false });
    const { out } = await run(bytes, [runEdit({ x: 50, baseline: 100, fontSize: 14, original: "Hi", text: "Yo" })]);
    const r = await reload(out);
    expect(r.getTitle()).toBe("Résumé");
    expect(r.getPageCount()).toBe(1);
  });

  it("keeps the previous behaviour for plain text boxes, highlights, images and page rotation", async () => {
    const bytes = await helveticaDoc([["Base", 50, 200]]);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const anns: Annotation[] = [
      { id: "t", type: "text", fileId: "f1", page: 0, x: 50, y: 20, fontSize: 12, color: "#ff0000", text: "Added text" },
      { id: "h", type: "highlight", fileId: "f1", page: 0, x: 50, y: 80, w: 100, h: 14 },
      { id: "i", type: "image", fileId: "f1", page: 0, x: 200, y: 20, w: 40, h: 40, src: png, mime: "image/png" },
    ];
    const info = { width: 400, height: 300, rotate: 0, view: [0, 0, 400, 300] } as PageInfo;
    const out = await exportPdf([source("f1", bytes, [info])], { annotations: anns, rotations: { "f1:0": 90 } });
    const r = await reload(out);
    expect(r.getPage(0).getRotation().angle).toBe(90);
    expect((await extract(out)).map((i) => i.str)).toEqual(expect.arrayContaining(["Base", "Added text"]));
  });

  it("still turns characters no font can draw into '?' without throwing when no fallback fonts are supplied", async () => {
    const bytes = await helveticaDoc([["Base", 50, 200]]);
    const info = { width: 400, height: 300, rotate: 0, view: [0, 0, 400, 300] } as PageInfo;
    const anns: Annotation[] = [{ id: "t", type: "text", fileId: "f1", page: 0, x: 50, y: 20, fontSize: 12, color: "#000000", text: "Héllo 日本" }];
    const out = await exportPdf([source("f1", bytes, [info])], { annotations: anns, rotations: {} });
    expect((await extract(out)).map((i) => i.str).join("|")).toContain("Héllo ??");
  });
});
