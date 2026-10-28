import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { exportPdf, hasUnsupportedChars } from "./export";
import { pageKey, toUnrotated, toUserSpace, type Annotation, type PageInfo, type PdfSource } from "@/editor/model";

async function source(id: string, pageCount: number): Promise<PdfSource> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 300]);
  const info: PageInfo = { width: 200, height: 300, rotate: 0, view: [0, 0, 200, 300] };
  return { id, file: new File([(await doc.save()) as BlobPart], `${id}.pdf`), pages: Array.from({ length: pageCount }, () => info) };
}

const empty = { annotations: [], rotations: {} };
const text = (fileId: string, value: string): Annotation => ({
  id: "t", fileId, page: 0, type: "text", x: 10, y: 10, fontSize: 12, color: "#000000", text: value,
});

describe("exportPdf", () => {
  it("merges files in the given order", async () => {
    const a = await source("a", 2);
    const b = await source("b", 1);
    const out = await PDFDocument.load(await exportPdf([b, a], empty));
    expect(out.getPageCount()).toBe(3);
  });

  it("adds the user's rotation to the page's own rotation", async () => {
    const a = await source("a", 2);
    const out = await PDFDocument.load(
      await exportPdf([a], { annotations: [], rotations: { [pageKey("a", 1)]: 270 } }),
    );
    expect(out.getPage(0).getRotation().angle).toBe(0);
    expect(out.getPage(1).getRotation().angle).toBe(270);
  });

  it("writes text, highlights and images without error", async () => {
    const a = await source("a", 1);
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    const annotations: Annotation[] = [
      text("a", "Line one\nLine two"),
      { id: "h", fileId: "a", page: 0, type: "highlight", x: 0, y: 0, w: 50, h: 10 },
      { id: "i", fileId: "a", page: 0, type: "image", x: 5, y: 5, w: 20, h: 20, src: png, mime: "image/png" },
    ];
    const out = await PDFDocument.load(await exportPdf([a], { annotations, rotations: {} }));
    expect(out.getPageCount()).toBe(1);
  });

  it("replaces characters the standard font cannot encode instead of failing", async () => {
    const a = await source("a", 1);
    expect(hasUnsupportedChars("héllo – “quoted” €5")).toBe(false);
    expect(hasUnsupportedChars("日本語")).toBe(true);
    await expect(exportPdf([a], { annotations: [text("a", "日本語 ok")], rotations: {} })).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });
});

describe("geometry", () => {
  it("maps upright coordinates into user space for every /Rotate", () => {
    const view: PageInfo["view"] = [0, 0, 200, 300];
    const at = (rotate: number) => toUserSpace({ width: 0, height: 0, rotate, view }, 10, 20);
    expect(at(0)).toEqual([10, 280]);
    expect(at(90)).toEqual([20, 10]);
    expect(at(180)).toEqual([190, 20]);
    expect(at(270)).toEqual([180, 290]);
  });

  it("inverts a displayed rotation", () => {
    // A 200x300 page rotated 90° clockwise is displayed 300x200; its top-left corner lands at the display's top-right.
    expect(toUnrotated(300, 0, 90, 200, 300)).toEqual([0, 0]);
    expect(toUnrotated(0, 0, 180, 200, 300)).toEqual([200, 300]);
    expect(toUnrotated(0, 0, 270, 200, 300)).toEqual([200, 0]);
    expect(toUnrotated(5, 7, 0, 200, 300)).toEqual([5, 7]);
  });
});
