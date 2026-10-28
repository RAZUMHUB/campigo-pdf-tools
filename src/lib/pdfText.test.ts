import { describe, expect, it } from "vitest";
import { PDFName, rgb } from "pdf-lib";
import { replaceInPage } from "./pdfText";
import { NOTO, StandardFonts, allStreamsText, contentText, extract, newDoc, reload } from "./testPdf";

const save = (doc: Awaited<ReturnType<typeof newDoc>>) => doc.save({ useObjectStreams: false });

describe("replaceInPage: standard (non-embedded) font", () => {
  it("rewrites the string in place, keeps other text, and leaves no trace of the old text", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Hello World 12345", { x: 50, y: 200, size: 14, font, color: rgb(0.2, 0.2, 0.8) });
    page.drawText("Untouched line", { x: 50, y: 150, size: 14, font });
    const loaded = await reload(await save(doc));

    const [res] = replaceInPage(loaded, loaded.getPage(0), [
      { id: "a", x: 50, y: 200, text: "Hello World 12345", replacement: "Goodbye W0rld 99" },
    ]);
    expect(res.status).toBe("in-place");

    const out = await save(loaded);
    const text = (await extract(out)).map((i) => i.str);
    expect(text).toContain("Goodbye W0rld 99");
    expect(text).toContain("Untouched line");
    expect(text.join("|")).not.toContain("Hello");
    // Colour operator and position of the edited line are preserved (nothing was redrawn or covered).
    const content = contentText(await reload(out));
    expect(content).toContain("0.2 0.2 0.8 rg");
    expect(content).not.toMatch(/^f$/m); // nothing was filled, i.e. no cover
    // The original string bytes must not survive as an orphan object anywhere in the file.
    expect(allStreamsText(await reload(out))).not.toContain("48656C6C6F"); // "Hello" in hex
  });

  it("reports not-found and leaves the stream untouched when nothing matches", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    page.drawText("Hello", { x: 50, y: 200, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
    const loaded = await reload(await save(doc));
    const before = contentText(loaded);
    const res = replaceInPage(loaded, loaded.getPage(0), [
      { id: "a", x: 50, y: 100, text: "Hello", replacement: "X" }, // wrong baseline
      { id: "b", x: 50, y: 200, text: "Nope", replacement: "X" }, // wrong text
    ]);
    expect(res.map((r) => r.status)).toEqual(["not-found", "not-found"]);
    expect(contentText(loaded)).toBe(before);
  });

  it("matches a run built from several strings (TJ array + Tj + positioned pieces)", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const F = page.node.newFontDictionary("F1", font.ref).toString();
    const ctx = doc.context;
    page.node.addContentStream(
      ctx.register(
        ctx.stream(
          [
            `BT ${F} 12 Tf 50 250 Td [(Hel) -20 (lo ) 5 (Wor)] TJ (ld) Tj ET`,
            `BT ${F} 12 Tf 1 0 0 1 50 200 Tm (Keep) Tj ET`,
            `BT ${F} 12 Tf 1 0 0 1 50 150 Tm (Pie) Tj 1 0 0 1 70 150 Tm (ces) Tj ET`,
          ].join("\n"),
        ),
      ),
    );
    const loaded = await reload(await save(doc));
    const res = replaceInPage(loaded, loaded.getPage(0), [
      { id: "a", x: 50, y: 250, text: "Hello World", replacement: "Bye" },
      { id: "b", x: 50, y: 150, text: "Pieces", replacement: "Parts" },
    ]);
    expect(res.map((r) => r.status)).toEqual(["in-place", "in-place"]);
    const text = (await extract(await save(loaded))).map((i) => i.str).join("|");
    expect(text).toContain("Bye");
    expect(text).toContain("Keep");
    expect(text).toContain("Parts");
    expect(text).not.toMatch(/Hel|Wor|ld|Pie|ces/);
  });

  it("removes text drawn twice at the same spot (fake bold)", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("Heading", { x: 50, y: 200, size: 20, font });
    page.drawText("Heading", { x: 50.4, y: 200, size: 20, font });
    const loaded = await reload(await save(doc));
    const [res] = replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 200, text: "Heading", replacement: "Title" }]);
    expect(res.status).toBe("in-place");
    const text = (await extract(await save(loaded))).map((i) => i.str);
    expect(text).toEqual(["Title"]);
  });

  it("does not touch invisible OCR text", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const F = page.node.newFontDictionary("F1", font.ref).toString();
    const ctx = doc.context;
    page.node.addContentStream(ctx.register(ctx.stream(`BT ${F} 12 Tf 3 Tr 1 0 0 1 50 200 Tm (Scanned) Tj ET`)));
    const loaded = await reload(await save(doc));
    const [res] = replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 200, text: "Scanned", replacement: "X" }]);
    expect(res).toMatchObject({ status: "not-found", reason: expect.stringContaining("invisible") });
  });
});

describe("replaceInPage: embedded subset font (Identity-H)", () => {
  // Two separate embedFont() calls give two separate subsets, like two fonts in a real document.
  const build = async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    const a = await doc.embedFont(NOTO(), { subset: true });
    const b = await doc.embedFont(NOTO(), { subset: true });
    page.drawText("Prince Kumar Mandal", { x: 50, y: 150, size: 12, font: a });
    page.drawText("Other 0123456789", { x: 50, y: 100, size: 12, font: b });
    return reload(await save(doc));
  };

  it("reuses the original font when every new character is already in the subset", async () => {
    const loaded = await build();
    const [res] = replaceInPage(loaded, loaded.getPage(0), [
      { id: "a", x: 50, y: 150, text: "Prince Kumar Mandal", replacement: "Mandal Kumar" },
    ]);
    expect(res.status).toBe("in-place");
    const items = (await extract(await save(loaded))).map((i) => i.str);
    expect(items).toContain("Mandal Kumar");
    expect(items).not.toContain("Prince Kumar Mandal");
    expect(items).toContain("Other 0123456789");
  });

  it("never borrows a glyph from a different subset (digits are drawn on the page, but only with the other font)", async () => {
    const loaded = await build();
    const [res] = replaceInPage(loaded, loaded.getPage(0), [
      { id: "a", x: 50, y: 150, text: "Prince Kumar Mandal", replacement: "Mandal 90" },
    ]);
    expect(res.status).toBe("removed");
  });

  it("removes the original and asks for a substitute when a glyph is missing from the subset", async () => {
    const loaded = await build();
    const [res] = replaceInPage(loaded, loaded.getPage(0), [
      { id: "a", x: 50, y: 150, text: "Prince Kumar Mandal", replacement: "Zq Xj" },
    ]);
    expect(res.status).toBe("removed");
    if (res.status === "removed") {
      expect(res.style.serif).toBe(false);
      expect(res.fill).toEqual([0, 0, 0]);
    }
    const items = (await extract(await save(loaded))).map((i) => i.str);
    expect(items).not.toContain("Prince Kumar Mandal");
    expect(items).toContain("Other 0123456789");
  });

  it("handles an empty replacement (deleting the text)", async () => {
    const loaded = await build();
    const [res] = replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 150, text: "Prince Kumar Mandal", replacement: "" }]);
    expect(res.status).toBe("in-place");
    const items = (await extract(await save(loaded))).map((i) => i.str);
    expect(items).toEqual(["Other 0123456789"]);
  });
});

describe("content stream replacement hygiene", () => {
  it("keeps other pages sharing the same stream intact", async () => {
    const doc = await newDoc();
    const p1 = doc.addPage([400, 300]);
    p1.drawText("Shared", { x: 50, y: 200, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
    const p2 = doc.addPage([400, 300]);
    p2.node.set(PDFName.of("Contents"), p1.node.get(PDFName.of("Contents"))!);
    p2.node.set(PDFName.of("Resources"), p1.node.get(PDFName.of("Resources"))!);
    const loaded = await reload(await save(doc));
    replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 200, text: "Shared", replacement: "Changed" }]);
    const out = await save(loaded);
    expect((await extract(out, 1)).map((i) => i.str)).toEqual(["Changed"]);
    expect((await extract(out, 2)).map((i) => i.str)).toEqual(["Shared"]);
  });
});

describe("one font object under several resource names", () => {
  it("counts glyphs used under any name (pdf-lib gives every drawText its own name)", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    const f = await doc.embedFont(NOTO(), { subset: true });
    page.drawText("Prince Kumar", { x: 50, y: 150, size: 12, font: f });
    page.drawText("0123456789", { x: 50, y: 100, size: 12, font: f });
    const loaded = await reload(await save(doc));
    const [res] = replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 150, text: "Prince Kumar", replacement: "Kumar 90" }]);
    expect(res.status).toBe("in-place");
  });
});
