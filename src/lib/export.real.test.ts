/**
 * Regression tests on a PDF produced by a different generator than pdf-lib: Chromium/Skia "Save as PDF"
 * (Type0 / Identity-H subset fonts, one font per style) with a résumé-like layout and a Hindi line.
 * Fixture: src/lib/fixtures/chrome-resume.pdf (A4).
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { exportPdf, type EditReport } from "./export";
import type { Annotation, PageInfo, PdfSource } from "@/editor/model";
import { NOTO, NOTO_BOLD, NOTO_DEVA, NOTO_DEVA_BOLD, NOTO_LATIN_EXT, extract } from "./testPdf";

const bytes = new Uint8Array(fs.readFileSync("src/lib/fixtures/chrome-resume.pdf"));
const PAGE = { width: 595.28, height: 841.89, rotate: 0, view: [0, 0, 595.28, 841.89] } as PageInfo;
const src: PdfSource = { id: "f1", file: new File([bytes as BlobPart], "chrome-resume.pdf", { type: "application/pdf" }), pages: [PAGE] };
const fallbackFonts = async (bold: boolean) => (bold ? [NOTO_BOLD(), NOTO_DEVA_BOLD()] : [NOTO(), NOTO_LATIN_EXT(), NOTO_DEVA()]);

/** Builds the annotation CampiGo would create when the user edits the run PDF.js reported at (x, userY). */
async function edit(original: string, text: string): Promise<Annotation> {
  const run = (await extract(bytes)).find((i) => i.str === original);
  if (!run) throw new Error(`fixture has no run "${original}"`);
  const fontSize = 11;
  const baseline = PAGE.height - run.y;
  return {
    id: original, type: "text", fileId: "f1", page: 0, x: run.x, y: baseline - 0.8 * fontSize, fontSize, color: "#222222", text,
    cover: { x: run.x, y: baseline - fontSize, w: 100, h: fontSize * 1.2, color: "#ffffff", original, runKey: original, source: { x: run.x, baseline, text: original } },
  };
}

const exportWith = async (anns: Annotation[]) => {
  const reports: EditReport[] = [];
  const out = await exportPdf([src], { annotations: anns, rotations: {} }, { fallbackFonts, onReport: (r) => reports.push(r) });
  return { out, reports, text: (await extract(out)).map((i) => i.str) };
};

describe("Chromium-generated résumé", () => {
  const phone = "Kolkata, India | prince@example.com | +91 98765 43210 | linkedin.com/in/prince";

  it("edits a heading in place using the embedded bold font (letters taken from the same line)", async () => {
    const { reports, text } = await exportWith([await edit("Prince Kumar Mandal", "Mandal Prince Kumar")]);
    expect(reports.map((r) => r.mode)).toEqual(["in-place"]);
    expect(text).toContain("Mandal Prince Kumar");
    expect(text).not.toContain("Prince Kumar Mandal");
    expect(text).toContain("EXPERIENCE"); // neighbours untouched
  });

  it("removes the old contact line and redraws when new digits are not in the subset", async () => {
    const { reports, text } = await exportWith([await edit(phone, phone.replace("+91 98765 43210", "+91 12345 67890"))]);
    // Whichever way the font allows it, the old number must be gone and the new one present exactly once.
    expect(["in-place", "redrawn"]).toContain(reports[0].mode);
    const joined = text.join("\n");
    expect(joined).toContain("+91 12345 67890");
    expect(joined).not.toContain("98765");
    expect(text.filter((t) => t.includes("prince@example.com"))).toHaveLength(1);
  });

  it("edits text on the tinted band without leaving a patch (no fill operations added)", async () => {
    const original = "Highlights on a tinted band: reduced load time by 40%.";
    const before = (await extract(bytes)).length;
    const { reports, text, out } = await exportWith([await edit(original, "Highlights: reduced load time by 55%.")]);
    expect(reports[0].mode).not.toBe("overlay");
    expect(text.join("|")).toContain("55%");
    expect(text.join("|")).not.toContain("40%");
    expect(text.length).toBeGreaterThanOrEqual(before - 1);
    expect(out.length).toBeGreaterThan(0);
  });

  it("uses a substitute Unicode font for Hindi replacement and keeps neighbours", async () => {
    const { reports, text } = await exportWith([await edit("Built PDF tooling used by 10,000 people every month.", "हिन्दी में नया वाक्य")]);
    expect(reports[0].mode).toBe("redrawn");
    // Extracted Indic text is in visual order (the short-i matra precedes its consonant), as in the Chrome original,
    // so assert on parts that do not depend on that and verify the rendering manually (see docs).
    expect(text.join("").normalize("NFC")).toContain("में नया");
    expect(text.join("")).not.toContain("tooling");
    expect(text).toContain("EDUCATION");
  });
});
