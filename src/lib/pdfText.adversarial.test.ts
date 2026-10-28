import { describe, expect, it } from "vitest";
import { PDFName } from "pdf-lib";
import { replaceInPage } from "./pdfText";
import { StandardFonts, extract, newDoc, reload } from "./testPdf";

const save = (d: Awaited<ReturnType<typeof newDoc>>) => d.save({ useObjectStreams: false });

async function pageWith(content: string[]) {
  const doc = await newDoc();
  const page = doc.addPage([400, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const F = page.node.newFontDictionary("F1", font.ref).toString();
  const ctx = doc.context;
  for (const c of content) page.node.addContentStream(ctx.register(ctx.stream(c.replaceAll("$F", F))));
  return { loaded: await reload(await save(doc)), F };
}

describe("tokenizer / interpreter edge cases", () => {
  it("handles nested parens, escapes, octal, comments and odd numbers", async () => {
    const { loaded } = await pageWith([
      "BT $F 12 Tf 50 250 Td (a\\(b\\) (nested) \\101\\102 c\\\\d) Tj ET % (Tj) comment",
      "BT $F -.5e 12 Tf 12. 0 0 12 50 200 Tm <48 65 6C6C 6F> Tj ET",
    ]);
    const res = replaceInPage(loaded, loaded.getPage(0), [
      { id: "a", x: 50, y: 250, text: "a(b) (nested) AB c\\d", replacement: "ok1" },
      { id: "b", x: 50, y: 200, text: "Hello", replacement: "ok2" },
    ]);
    expect(res[0].status).toBe("in-place");
    expect(res[1].status).toBe("in-place");
    const t = (await extract(await save(loaded))).map((i) => i.str).join("|");
    expect(t).toContain("ok1");
    expect(t).toContain("ok2");
  });

  it("does not mistake inline-image bytes for operators", async () => {
    const { loaded } = await pageWith([
      "q 10 0 0 10 300 100 cm BI /W 2 /H 2 /CS /G /BPC 8 ID (Tj) ET BT (x) Tj \nEI Q BT $F 12 Tf 50 250 Td (Real) Tj ET",
    ]);
    const [r] = replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 250, text: "Real", replacement: "Fine" }]);
    expect(r.status).toBe("in-place");
    expect((await extract(await save(loaded))).map((i) => i.str)).toContain("Fine");
  });

  it("does not edit text that lives in a Form XObject (reports not-found)", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ctx = doc.context;
    const fontName = "F1";
    const form = ctx.stream("BT /F1 12 Tf 50 200 Td (InsideForm) Tj ET", {
      Type: "XObject", Subtype: "Form", BBox: [0, 0, 400, 300],
      Resources: ctx.obj({ Font: { [fontName]: font.ref } }),
    });
    const formRef = ctx.register(form);
    page.node.setXObject?.(PDFName.of("Fm1"), formRef);
    const res = page.node.Resources()!;
    res.set(PDFName.of("XObject"), ctx.obj({ Fm1: formRef }));
    page.node.addContentStream(ctx.register(ctx.stream("q /Fm1 Do Q")));
    const loaded = await reload(await save(doc));
    const before = (await extract(await save(loaded))).map((i) => i.str);
    expect(before).toContain("InsideForm");
    const [r] = replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 200, text: "InsideForm", replacement: "X" }]);
    expect(r.status).toBe("not-found");
  });

  it("refuses to guess when an embedded font has no encoding and no ToUnicode", async () => {
    const doc = await newDoc();
    const page = doc.addPage([400, 300]);
    const ctx = doc.context;
    const desc = ctx.register(ctx.obj({ Type: "FontDescriptor", FontName: "ABCDEF+Mystery", Flags: 4, FontFile2: ctx.register(ctx.stream("x")) }));
    const fontRef = ctx.register(ctx.obj({ Type: "Font", Subtype: "TrueType", BaseFont: "ABCDEF+Mystery", FirstChar: 65, LastChar: 66, Widths: [600, 600], FontDescriptor: desc }));
    const F = page.node.newFontDictionary("F1", fontRef).toString();
    page.node.addContentStream(ctx.register(ctx.stream(`BT ${F} 12 Tf 50 200 Td (AB) Tj ET`)));
    const loaded = await reload(await save(doc));
    const [r] = replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 200, text: "AB", replacement: "BA" }]);
    expect(r.status).toBe("not-found");
  });

  it("uses the same text only once when two lines are identical at different heights", async () => {
    const { loaded } = await pageWith(["BT $F 12 Tf 50 250 Td (Same) Tj ET BT $F 12 Tf 50 150 Td (Same) Tj ET"]);
    replaceInPage(loaded, loaded.getPage(0), [{ id: "a", x: 50, y: 150, text: "Same", replacement: "Low" }]);
    const items = await extract(await save(loaded));
    expect(items.map((i) => i.str).sort()).toEqual(["Low", "Same"]);
    expect(items.find((i) => i.str === "Low")!.y).toBeCloseTo(150, 0);
  });

  it("two requests on the same text: second reports overlap, nothing is corrupted", async () => {
    const { loaded } = await pageWith(["BT $F 12 Tf 50 250 Td (Dup) Tj ET"]);
    const res = replaceInPage(loaded, loaded.getPage(0), [
      { id: "a", x: 50, y: 250, text: "Dup", replacement: "One" },
      { id: "b", x: 50, y: 250, text: "Dup", replacement: "Two" },
    ]);
    expect(res.map((r) => r.status)).toEqual(["in-place", "not-found"]);
    expect((await extract(await save(loaded))).map((i) => i.str)).toEqual(["One"]);
  });
});
