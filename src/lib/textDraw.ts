/**
 * Draws replacement/new text with a substitute font when the original font cannot be reused.
 *
 *  - Text that fits Windows-1252 uses the standard PDF font closest to the original (Helvetica / Times / Courier).
 *  - Anything else (Hindi, Latin Extended, ₹ ...) uses an embedded Unicode font chain, loaded lazily by the app.
 *    pdf-lib + fontkit apply OpenType shaping (GSUB), so Devanagari conjuncts and matras are formed.
 *  - Characters no font can draw become "?" and are reported, never silently dropped.
 */
// @pdf-lib/fontkit's Indic (Devanagari) shaper uses generators compiled to a global `regeneratorRuntime`; without this
// polyfill the first Hindi edit throws "regeneratorRuntime is not defined" (in Node and in the browser build alike).
import "regenerator-runtime/runtime";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb, type Degrees } from "pdf-lib";
import type { FontStyle } from "./pdfText";

/** Returns font files (TTF/OTF/WOFF), in priority order, for regular or bold text. */
export type FallbackFontLoader = (bold: boolean) => Promise<Array<ArrayBuffer | Uint8Array>>;

// Standard PDF fonts are limited to the WinAnsi (Windows-1252) character set.
export const WIN_ANSI = new Set<string>();
{
  const decoder = new TextDecoder("windows-1252");
  for (let byte = 0x20; byte <= 0xff; byte++) {
    const ch = decoder.decode(Uint8Array.of(byte));
    if (/\P{Cc}/u.test(ch)) WIN_ANSI.add(ch);
  }
}

/** Ranges the bundled fallback fonts (Noto Sans Latin/Latin-Ext + Devanagari) can draw. */
const FALLBACK_RANGES = /[Ā-ɏḀ-ỿ -⁯₠-⃏ऀ-ॿ꣠-ꣿ‌‍]/u;

/** True if neither the standard fonts nor the bundled fallback fonts can draw `text`. */
export const unsupportedAfterFallback = (text: string) =>
  Array.from(text).some((ch) => ch !== "\n" && ch !== "\t" && !WIN_ANSI.has(ch) && !FALLBACK_RANGES.test(ch));

export const needsFallbackFont = (text: string) =>
  Array.from(text).some((ch) => ch !== "\n" && ch !== "\t" && !WIN_ANSI.has(ch));

/** Maps a PDF.js / CSS font family string to the styles we can pick between. */
export function styleFromFamily(family?: string): FontStyle {
  const f = family ?? "";
  return {
    bold: /bold|black|heavy/i.test(f),
    italic: /italic|oblique/i.test(f),
    mono: /mono|courier|consolas/i.test(f),
    serif: /serif/i.test(f) && !/sans/i.test(f),
  };
}

const PLAIN: FontStyle = { bold: false, italic: false, serif: false, mono: false };

function standardName(s: FontStyle): StandardFonts {
  if (s.mono) {
    return s.bold && s.italic ? StandardFonts.CourierBoldOblique : s.bold ? StandardFonts.CourierBold : s.italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  }
  if (s.serif) {
    return s.bold && s.italic ? StandardFonts.TimesRomanBoldItalic : s.bold ? StandardFonts.TimesRomanBold : s.italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  }
  return s.bold && s.italic ? StandardFonts.HelveticaBoldOblique : s.bold ? StandardFonts.HelveticaBold : s.italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

interface ChainFont {
  font: PDFFont;
  has: Set<number>;
}

export class TextPainter {
  /** Characters that no available font could draw (shown as "?"). */
  readonly missing = new Set<string>();
  private standard = new Map<StandardFonts, PDFFont>();
  private chains = new Map<boolean, Promise<ChainFont[]>>();

  constructor(
    private readonly doc: PDFDocument,
    private readonly loader?: FallbackFontLoader,
  ) {}

  private async std(style: FontStyle) {
    const name = standardName(style);
    let font = this.standard.get(name);
    if (!font) this.standard.set(name, (font = await this.doc.embedFont(name)));
    return font;
  }

  private chain(bold: boolean): Promise<ChainFont[]> {
    let chain = this.chains.get(bold);
    if (!chain) {
      chain = (async () => {
        if (!this.loader) return [];
        try {
          const files = await this.loader(bold);
          if (!files.length) return [];
          const fontkit = (await import("@pdf-lib/fontkit")).default;
          this.doc.registerFontkit(fontkit);
          const out: ChainFont[] = [];
          for (const bytes of files) {
            const font = await this.doc.embedFont(bytes, { subset: true });
            out.push({ font, has: new Set(font.getCharacterSet()) });
          }
          return out;
        } catch (error) {
          console.error("Fallback fonts could not be loaded", error);
          return [];
        }
      })();
      this.chains.set(bold, chain);
    }
    return chain;
  }

  /** Splits one line into pieces that each use a single font. */
  private async layout(line: string, style: FontStyle): Promise<Array<{ font: PDFFont; text: string }>> {
    const text = line.replaceAll("\t", "    ");
    const std = await this.std(style);
    const chars = Array.from(text);
    if (chars.every((ch) => WIN_ANSI.has(ch))) return [{ font: std, text }];

    const chain = await this.chain(style.bold);
    const pieces: Array<{ font: PDFFont; text: string }> = [];
    const push = (font: PDFFont, ch: string) => {
      const last = pieces[pieces.length - 1];
      if (last && last.font === font) last.text += ch;
      else pieces.push({ font, text: ch });
    };
    for (const ch of chars) {
      const cp = ch.codePointAt(0)!;
      const joiner = cp === 0x200c || cp === 0x200d;
      const found = chain.find((c) => c.has.has(cp));
      if (found) push(found.font, ch);
      else if (joiner) {
        // Zero-width joiners shape neighbouring letters; keep them with the previous piece if it can hold them.
        const prev = pieces[pieces.length - 1];
        if (prev && chain.some((c) => c.font === prev.font && c.has.has(cp))) prev.text += ch;
      } else if (!chain.length && WIN_ANSI.has(ch)) push(std, ch);
      else {
        this.missing.add(ch);
        push(chain[0]?.font ?? std, chain.length ? "?" : "?");
      }
    }
    return pieces;
  }

  /** Draws one line starting at (x, y) in user space. `rotate` is the page's own rotation. */
  async drawLine(
    page: PDFPage,
    line: string,
    o: { x: number; y: number; size: number; color: ReturnType<typeof rgb>; rotate?: Degrees; style?: FontStyle },
  ) {
    const rotate = o.rotate ?? degrees(0);
    const angle = (rotate.angle * Math.PI) / 180;
    let { x, y } = o;
    for (const piece of await this.layout(line, o.style ?? PLAIN)) {
      page.drawText(piece.text, { x, y, size: o.size, font: piece.font, color: o.color, rotate });
      const width = piece.font.widthOfTextAtSize(piece.text, o.size);
      x += width * Math.cos(angle);
      y += width * Math.sin(angle);
    }
  }
}
