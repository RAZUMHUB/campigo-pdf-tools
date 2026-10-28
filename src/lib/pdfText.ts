/**
 * In-place text replacement for existing PDF text.
 *
 * Why this exists: PDF.js can *find* text (positions, strings) but cannot edit it, and drawing a coloured
 * rectangle plus new text on top leaves the original glyphs in the file, mismatches backgrounds and fonts,
 * and shows both strings to anything that extracts text. This module edits the page's content stream
 * instead:
 *
 *   1. Tokenise the content stream and run a minimal text-state interpreter (BT/ET, Tf, Tm, Td, TJ, ...).
 *   2. Decode each shown string to Unicode using the font's ToUnicode CMap / encoding.
 *   3. Find the strings that make up the run PDF.js reported (same start point, same text).
 *   4. Splice the new string into the first one and empty the rest. When the original font can draw every
 *      new character ("in-place") the result keeps the original font, colour, size and spacing exactly.
 *      When it cannot ("removed") the original text is still removed and the caller draws a substitute.
 *   5. If the run cannot be located or decoded safely ("not-found") the stream is left untouched and the
 *      caller falls back to the legacy overlay.
 *
 * Deliberate limits (all reported, never silent): text inside Form XObjects, invisible (OCR) text, fonts
 * without a usable encoding, and fonts whose subset lacks a needed glyph.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from "pdf-lib";

// ── Public types ─────────────────────────────────────────────────────────────

export type RGB = [number, number, number];

export interface FontStyle {
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
}

export interface ReplaceRequest {
  id: string;
  /** Start of the original run in PDF user space (x, baseline). */
  x: number;
  y: number;
  /** Original text exactly as PDF.js extracted it. */
  text: string;
  /** New text. */
  replacement: string;
}

export type ReplaceResult =
  | { id: string; status: "in-place" }
  | { id: string; status: "removed"; reason: string; style: FontStyle; fill: RGB }
  | { id: string; status: "not-found"; reason: string };

// ── Tokeniser ────────────────────────────────────────────────────────────────

type Tok =
  | { k: "num"; v: number; s: number; e: number }
  | { k: "name"; v: string; s: number; e: number }
  | { k: "str"; bytes: Uint8Array; s: number; e: number }
  | { k: "arr"; items: Tok[]; s: number; e: number }
  | { k: "dict"; s: number; e: number }
  | { k: "op"; v: string; s: number; e: number }
  | { k: "close"; s: number; e: number };

interface Op {
  name: string;
  operands: Tok[];
}

const isWs = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) =>
  c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const HEX = /^[0-9a-fA-F]$/;

class Lexer {
  i = 0;
  constructor(readonly d: Uint8Array) {}

  private skip() {
    const d = this.d;
    while (this.i < d.length) {
      const c = d[this.i];
      if (isWs(c)) this.i++;
      else if (c === 37) while (this.i < d.length && d[this.i] !== 10 && d[this.i] !== 13) this.i++;
      else break;
    }
  }

  next(): Tok | null {
    this.skip();
    const d = this.d;
    if (this.i >= d.length) return null;
    const s = this.i;
    const c = d[s];

    if (c === 47) {
      this.i++;
      let v = "";
      while (this.i < d.length && !isWs(d[this.i]) && !isDelim(d[this.i])) {
        let ch = d[this.i];
        const h = String.fromCharCode(d[this.i + 1] ?? 0, d[this.i + 2] ?? 0);
        if (ch === 35 && /^[0-9a-fA-F]{2}$/.test(h)) {
          ch = parseInt(h, 16);
          this.i += 2;
        }
        v += String.fromCharCode(ch);
        this.i++;
      }
      return { k: "name", v, s, e: this.i };
    }

    if (c === 40) return this.literal(s);

    if (c === 60) {
      if (d[s + 1] === 60) {
        this.i += 2;
        for (let t = this.next(); t && t.k !== "close"; t = this.next());
        return { k: "dict", s, e: this.i };
      }
      this.i++;
      let hex = "";
      while (this.i < d.length && d[this.i] !== 62) {
        const ch = String.fromCharCode(d[this.i++]);
        if (HEX.test(ch)) hex += ch;
      }
      this.i++;
      if (hex.length % 2) hex += "0";
      const bytes = new Uint8Array(hex.length / 2);
      for (let j = 0; j < bytes.length; j++) bytes[j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
      return { k: "str", bytes, s, e: this.i };
    }

    if (c === 62) {
      this.i += d[s + 1] === 62 ? 2 : 1;
      return { k: "close", s, e: this.i };
    }

    if (c === 91) {
      this.i++;
      const items: Tok[] = [];
      for (let t = this.next(); t && t.k !== "close"; t = this.next()) items.push(t);
      return { k: "arr", items, s, e: this.i };
    }
    if (c === 93) {
      this.i++;
      return { k: "close", s, e: this.i };
    }
    if (c === 41 || c === 123 || c === 125) {
      this.i++;
      return this.next();
    }

    while (this.i < d.length && !isWs(d[this.i]) && !isDelim(d[this.i])) this.i++;
    const word = String.fromCharCode(...d.subarray(s, this.i));
    return NUMBER.test(word) ? { k: "num", v: parseFloat(word), s, e: this.i } : { k: "op", v: word, s, e: this.i };
  }

  private literal(s: number): Tok {
    const d = this.d;
    const out: number[] = [];
    let depth = 1;
    this.i++;
    while (this.i < d.length && depth > 0) {
      const ch = d[this.i++];
      if (ch === 92) {
        const n = d[this.i++];
        if (n === 110) out.push(10);
        else if (n === 114) out.push(13);
        else if (n === 116) out.push(9);
        else if (n === 98) out.push(8);
        else if (n === 102) out.push(12);
        else if (n === 13) {
          if (d[this.i] === 10) this.i++;
        } else if (n === 10) {
          /* line continuation */
        } else if (n >= 48 && n <= 55) {
          let v = n - 48;
          for (let k = 0; k < 2; k++) {
            const m = d[this.i];
            if (m >= 48 && m <= 55) {
              v = v * 8 + (m - 48);
              this.i++;
            } else break;
          }
          out.push(v & 255);
        } else out.push(n);
      } else if (ch === 40) {
        depth++;
        out.push(ch);
      } else if (ch === 41) {
        depth--;
        if (depth > 0) out.push(ch);
      } else out.push(ch);
    }
    return { k: "str", bytes: Uint8Array.from(out), s, e: this.i };
  }
}

function parseContent(data: Uint8Array): Op[] {
  const lexer = new Lexer(data);
  const ops: Op[] = [];
  let operands: Tok[] = [];
  for (let t = lexer.next(); t; t = lexer.next()) {
    if (t.k === "op") {
      ops.push({ name: t.v, operands });
      operands = [];
      if (t.v === "BI") skipInlineImage(lexer);
    } else if (t.k !== "close") {
      operands.push(t);
    }
  }
  return ops;
}

/** Skips an inline image's dictionary and binary data so the bytes are never mistaken for operators. */
function skipInlineImage(lexer: Lexer) {
  for (let t = lexer.next(); t; t = lexer.next()) if (t.k === "op" && t.v === "ID") break;
  const d = lexer.d;
  for (let j = lexer.i + 1; j < d.length - 1; j++) {
    if (d[j] === 69 && d[j + 1] === 73 && isWs(d[j - 1]) && (j + 2 >= d.length || isWs(d[j + 2]))) {
      lexer.i = j + 2;
      return;
    }
  }
  lexer.i = d.length;
}

// ── Text-state interpreter ───────────────────────────────────────────────────

type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

interface GState {
  ctm: Mat;
  font: string;
  size: number;
  th: number;
  tl: number;
  rise: number;
  mode: number;
  fill: RGB;
}

interface Seg {
  tok: Extract<Tok, { k: "str" }>;
  arr?: Tok;
  font: string;
  /** Position of the first glyph in user space; only meaningful when `known`. */
  x: number;
  y: number;
  /** True when no earlier glyph on this text line has advanced the pen, so x/y is exact without font metrics. */
  known: boolean;
  mode: number;
  fill: RGB;
  text: string | null;
}

const num = (t: Tok | undefined) => (t && t.k === "num" ? t.v : 0);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function interpret(
  ops: Op[],
  decode: (font: string, bytes: Uint8Array) => string | null,
  keyOf: (font: string) => string,
) {
  const segs: Seg[] = [];
  const used = new Map<string, Set<number>>();
  let gs: GState = { ctm: IDENTITY, font: "", size: 0, th: 1, tl: 0, rise: 0, mode: 0, fill: [0, 0, 0] };
  const stack: GState[] = [];
  let tm: Mat = IDENTITY;
  let tlm: Mat = IDENTITY;
  let advanced = false;

  const move = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
    advanced = false;
  };

  const show = (tok: Tok | undefined, arr?: Tok) => {
    if (!tok || tok.k !== "str") return;
    const m = mul(tm, gs.ctm);
    segs.push({
      tok,
      arr,
      font: gs.font,
      x: gs.rise * m[2] + m[4],
      y: gs.rise * m[3] + m[5],
      known: !advanced,
      mode: gs.mode,
      fill: gs.fill,
      text: decode(gs.font, tok.bytes),
    });
    if (tok.bytes.length) advanced = true;
    // Keyed by font object, not resource name: several names can point at one subset.
    const key = keyOf(gs.font);
    let set = used.get(key);
    if (!set) used.set(key, (set = new Set()));
    for (const b of tok.bytes) set.add(b);
    // Two-byte (CID) fonts: record codes as pairs too; `FontInfo.encode` picks the right set by width.
    for (let j = 0; j + 1 < tok.bytes.length; j += 2) set.add(0x10000 + (tok.bytes[j] << 8) + tok.bytes[j + 1]);
  };

  for (const { name, operands: n } of ops) {
    switch (name) {
      case "q":
        stack.push({ ...gs });
        break;
      case "Q":
        gs = stack.pop() ?? gs;
        break;
      case "cm":
        gs = { ...gs, ctm: mul([num(n[0]), num(n[1]), num(n[2]), num(n[3]), num(n[4]), num(n[5])], gs.ctm) };
        break;
      case "BT":
        tm = tlm = IDENTITY;
        advanced = false;
        break;
      case "Tf":
        gs = { ...gs, font: n[0]?.k === "name" ? n[0].v : gs.font, size: num(n[1]) };
        break;
      case "Tz":
        gs = { ...gs, th: num(n[0]) / 100 };
        break;
      case "TL":
        gs = { ...gs, tl: num(n[0]) };
        break;
      case "Ts":
        gs = { ...gs, rise: num(n[0]) };
        break;
      case "Tr":
        gs = { ...gs, mode: num(n[0]) };
        break;
      case "Td":
        move(num(n[0]), num(n[1]));
        break;
      case "TD":
        gs = { ...gs, tl: -num(n[1]) };
        move(num(n[0]), num(n[1]));
        break;
      case "Tm":
        tm = tlm = [num(n[0]), num(n[1]), num(n[2]), num(n[3]), num(n[4]), num(n[5])];
        advanced = false;
        break;
      case "T*":
        move(0, -gs.tl);
        break;
      case "Tj":
        show(n[0]);
        break;
      case "'":
        move(0, -gs.tl);
        show(n[0]);
        break;
      case '"':
        move(0, -gs.tl);
        show(n[2]);
        break;
      case "TJ": {
        const arr = n[0];
        if (arr?.k !== "arr") break;
        for (const item of arr.items) {
          if (item.k === "str") show(item, arr);
          else if (item.k === "num" && !advanced) tm = mul([1, 0, 0, 1, (-item.v / 1000) * gs.size * gs.th, 0], tm);
        }
        break;
      }
      case "g":
        gs = { ...gs, fill: [clamp01(num(n[0])), clamp01(num(n[0])), clamp01(num(n[0]))] };
        break;
      case "rg":
        gs = { ...gs, fill: [clamp01(num(n[0])), clamp01(num(n[1])), clamp01(num(n[2]))] };
        break;
      case "k": {
        const [c, m, y, k] = [num(n[0]), num(n[1]), num(n[2]), num(n[3])];
        gs = { ...gs, fill: [clamp01((1 - c) * (1 - k)), clamp01((1 - m) * (1 - k)), clamp01((1 - y) * (1 - k))] };
        break;
      }
      case "sc":
      case "scn": {
        const v = n.filter((t) => t.k === "num").map(num);
        if (n.some((t) => t.k === "name")) break; // pattern fill: leave colour alone
        if (v.length === 1) gs = { ...gs, fill: [clamp01(v[0]), clamp01(v[0]), clamp01(v[0])] };
        else if (v.length === 3) gs = { ...gs, fill: [clamp01(v[0]), clamp01(v[1]), clamp01(v[2])] };
        else if (v.length === 4)
          gs = { ...gs, fill: [clamp01((1 - v[0]) * (1 - v[3])), clamp01((1 - v[1]) * (1 - v[3])), clamp01((1 - v[2]) * (1 - v[3]))] };
        break;
      }
    }
  }
  return { segs, used };
}

// ── Fonts ────────────────────────────────────────────────────────────────────

interface FontInfo {
  twoByte: boolean;
  embedded: boolean;
  style: FontStyle;
  decode(bytes: Uint8Array): string | null;
  /** Encodes `text` with glyphs that are guaranteed present, or null. `used` = codes shown on this page. */
  encode(text: string, used: Set<number>): Uint8Array | null;
}

const ACCENTS: Record<string, string> = {
  grave: "̀", acute: "́", circumflex: "̂", tilde: "̃", macron: "̄", breve: "̆",
  dotaccent: "̇", dieresis: "̈", ring: "̊", hungarumlaut: "̋", caron: "̌",
  cedilla: "̧", ogonek: "̨",
};
const GLYPHS: Record<string, string> = {
  space: " ", exclam: "!", quotedbl: '"', numbersign: "#", dollar: "$", percent: "%", ampersand: "&",
  quotesingle: "'", parenleft: "(", parenright: ")", asterisk: "*", plus: "+", comma: ",", hyphen: "-",
  period: ".", slash: "/", zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", colon: ":", semicolon: ";", less: "<", equal: "=", greater: ">",
  question: "?", at: "@", bracketleft: "[", backslash: "\\", bracketright: "]", asciicircum: "^",
  underscore: "_", grave: "`", braceleft: "{", bar: "|", braceright: "}", asciitilde: "~", bullet: "•",
  endash: "–", emdash: "—", quoteleft: "‘", quoteright: "’", quotedblleft: "“",
  quotedblright: "”", quotesinglbase: "‚", quotedblbase: "„", ellipsis: "…",
  fi: "ﬁ", fl: "ﬂ", ff: "ﬀ", ffi: "ﬃ", ffl: "ﬄ", copyright: "©",
  registered: "®", trademark: "™", degree: "°", plusminus: "±", multiply: "×",
  divide: "÷", section: "§", paragraph: "¶", dagger: "†", daggerdbl: "‡",
  Euro: "€", sterling: "£", yen: "¥", cent: "¢", germandbls: "ß", ae: "æ",
  AE: "Æ", oe: "œ", OE: "Œ", oslash: "ø", Oslash: "Ø", dotlessi: "ı",
  nbspace: " ", sfthyphen: "­", minus: "−", fraction: "⁄",
};

function glyphToChar(name: string): string | undefined {
  if (name in GLYPHS) return GLYPHS[name];
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  if (/^[A-Za-z]$/.test(name)) return name;
  const accented = /^([A-Za-z])(grave|acute|circumflex|tilde|macron|breve|dotaccent|dieresis|ring|hungarumlaut|caron|cedilla|ogonek)$/.exec(name);
  if (accented) return (accented[1] + ACCENTS[accented[2]]).normalize("NFC");
  return undefined;
}

function singleByteTable(encoding: string): Array<string | undefined> {
  const table: Array<string | undefined> = new Array(256).fill(undefined);
  if (encoding === "WinAnsiEncoding" || encoding === "MacRomanEncoding") {
    let decoder: TextDecoder | undefined;
    try {
      decoder = new TextDecoder(encoding === "WinAnsiEncoding" ? "windows-1252" : "macintosh");
    } catch {
      return table;
    }
    for (let c = 0x20; c < 256; c++) {
      const ch = decoder.decode(Uint8Array.of(c));
      if (/\P{Cc}/u.test(ch) && ch !== "�") table[c] = ch;
    }
    if (encoding === "WinAnsiEncoding") table[0xa0] = " ";
  } else if (encoding === "StandardEncoding") {
    for (let c = 0x20; c < 0x7f; c++) table[c] = String.fromCharCode(c);
    table[0x27] = "’";
    table[0x60] = "‘";
  }
  return table;
}

const subsetTag = /^[A-Z]{6}\+/;

function parseToUnicode(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const utf16 = (hex: string) => {
    let out = "";
    for (let i = 0; i + 3 < hex.length + 1 && i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4).padEnd(4, "0"), 16));
    return out;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]*)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (hi - lo > 0xffff) continue;
      if (m[3] !== undefined) {
        const base = utf16(m[3]);
        for (let c = lo; c <= hi; c++) {
          map.set(c, base.length ? base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo)) : "");
        }
      } else if (m[4] !== undefined) {
        let c = lo;
        for (const item of m[4].matchAll(/<([0-9A-Fa-f]*)>/g)) map.set(c++, utf16(item[1]));
      }
    }
  }
  return map;
}

const hexBytes = (bytes: number[]) => Uint8Array.from(bytes);

function readStream(stream: PDFStream): Uint8Array {
  return stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : (stream as unknown as { getUnencodedContents(): Uint8Array }).getUnencodedContents();
}

function fontStyle(name: string, flags: number): FontStyle {
  const n = name.replace(subsetTag, "");
  return {
    bold: /bold|black|heavy|semibold|demi/i.test(n) || (flags & 0x40000) !== 0,
    italic: /italic|oblique/i.test(n) || (flags & 0x40) !== 0,
    mono: /courier|mono|consolas|typewriter/i.test(n) || (flags & 1) !== 0,
    serif: ((flags & 2) !== 0 || /times|serif|georgia|garamond|palatino|cambria|minion|book/i.test(n)) && !/sans/i.test(n),
  };
}

function buildFont(doc: PDFDocument, dict: PDFDict): FontInfo | null {
  try {
    const ctx = doc.context;
    const subtype = dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.decodeText();
    const baseFont = dict.lookupMaybe(PDFName.of("BaseFont"), PDFName)?.decodeText() ?? "";
    const type0 = subtype === "Type0";
    let descDict = dict;
    if (type0) {
      const kids = dict.lookup(PDFName.of("DescendantFonts"), PDFArray);
      descDict = ctx.lookup(kids.get(0), PDFDict);
    }
    const descriptor = descDict.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
    const flags = descriptor?.lookupMaybe(PDFName.of("Flags"), PDFNumber)?.asNumber() ?? 0;
    const embedded = !!descriptor && ["FontFile", "FontFile2", "FontFile3"].some((k) => descriptor.has(PDFName.of(k)));
    const style = fontStyle(baseFont, flags);

    const toUniStream = dict.lookupMaybe(PDFName.of("ToUnicode"), PDFStream);
    const toUni = toUniStream ? parseToUnicode(Buffer_latin1(readStream(toUniStream))) : undefined;

    if (type0) {
      const enc = dict.lookupMaybe(PDFName.of("Encoding"), PDFName)?.decodeText();
      const identity = enc === "Identity-H" || enc === "Identity-V";
      const reverse = new Map<string, number>();
      for (const [code, ch] of toUni ?? []) {
        if ([...ch].length === 1 && (!reverse.has(ch) || code < reverse.get(ch)!)) reverse.set(ch, code);
      }
      return {
        twoByte: true,
        embedded: true,
        style,
        decode(bytes) {
          if (!identity || !toUni || bytes.length % 2) return null;
          let out = "";
          for (let i = 0; i < bytes.length; i += 2) {
            const ch = toUni.get((bytes[i] << 8) | bytes[i + 1]);
            if (ch === undefined) return null;
            out += ch;
          }
          return out;
        },
        encode(text, used) {
          const out: number[] = [];
          for (const ch of text) {
            const code = reverse.get(ch);
            // A glyph is only guaranteed to exist in a subset if it is actually drawn on this page.
            if (code === undefined || !used.has(0x10000 + code)) return null;
            out.push(code >> 8, code & 255);
          }
          return hexBytes(out);
        },
      };
    }

    // Simple fonts (Type1, TrueType, MMType1).
    const encObj = ctx.lookup(dict.get(PDFName.of("Encoding")));
    let baseName: string | undefined;
    let differences: PDFArray | undefined;
    if (encObj instanceof PDFName) baseName = encObj.decodeText();
    else if (encObj instanceof PDFDict) {
      baseName = encObj.lookupMaybe(PDFName.of("BaseEncoding"), PDFName)?.decodeText();
      differences = encObj.lookupMaybe(PDFName.of("Differences"), PDFArray);
    }
    if (!baseName && !embedded) baseName = "StandardEncoding";
    const table = singleByteTable(baseName ?? "");
    if (differences) {
      let code = 0;
      for (let i = 0; i < differences.size(); i++) {
        const item = ctx.lookup(differences.get(i));
        if (item instanceof PDFNumber) code = item.asNumber();
        else if (item instanceof PDFName) {
          if (code >= 0 && code < 256) table[code] = glyphToChar(item.decodeText());
          code++;
        }
      }
    }
    if (toUni) for (const [code, ch] of toUni) if (code < 256) table[code] = ch;
    // Embedded font with no encoding information at all: refuse to guess.
    const known = table.some((c) => c !== undefined);
    const reverse = new Map<string, number>();
    table.forEach((ch, code) => {
      if (ch !== undefined && [...ch].length === 1 && !reverse.has(ch)) reverse.set(ch, code);
    });
    return {
      twoByte: false,
      embedded,
      style,
      decode(bytes) {
        if (!known) return null;
        let out = "";
        for (const b of bytes) {
          const ch = table[b];
          if (ch === undefined) return null;
          out += ch;
        }
        return out;
      },
      encode(text, used) {
        const out: number[] = [];
        for (const ch of text) {
          const code = reverse.get(ch);
          if (code === undefined || (embedded && !used.has(code))) return null;
          out.push(code);
        }
        return hexBytes(out);
      },
    };
  } catch {
    return null;
  }
}

const Buffer_latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
};

// ── Page content access ──────────────────────────────────────────────────────

function contentRefs(doc: PDFDocument, page: PDFPage): PDFRef[] | null {
  const raw = page.node.get(PDFName.of("Contents"));
  if (raw instanceof PDFRef) {
    const resolved = doc.context.lookup(raw);
    if (resolved instanceof PDFArray) return resolved.asArray().filter((r): r is PDFRef => r instanceof PDFRef);
    return [raw];
  }
  if (raw instanceof PDFArray) return raw.asArray().filter((r): r is PDFRef => r instanceof PDFRef);
  return null;
}

function readContents(doc: PDFDocument, refs: PDFRef[]): Uint8Array {
  const parts = refs.map((r) => readStream(doc.context.lookup(r, PDFStream)));
  const total = parts.reduce((n, p) => n + p.length + 1, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
    out[at++] = 10;
  }
  return out;
}

function writeContents(doc: PDFDocument, page: PDFPage, oldRefs: PDFRef[], data: Uint8Array) {
  const ctx = doc.context;
  const ref = ctx.register(ctx.flateStream(data));
  const inUseElsewhere = new Set<string>();
  for (const other of doc.getPages()) {
    if (other === page) continue;
    for (const r of contentRefs(doc, other) ?? []) inUseElsewhere.add(r.tag);
  }
  page.node.set(PDFName.of("Contents"), ref);
  // pdf-lib saves every object in the context, so the old stream must be deleted or the original text stays in the file.
  for (const r of oldRefs) if (!inUseElsewhere.has(r.tag)) ctx.delete(r);
}

// ── Matching and splicing ────────────────────────────────────────────────────

const strip = (s: string) => s.replace(/\s+/g, "").normalize("NFC");
const POSITION_TOLERANCE = 1.5;
const toHex = (bytes: Uint8Array) => `<${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}>`;

function matchFrom(segs: Seg[], start: number, want: string): number | null {
  let acc = "";
  for (let j = start; j < segs.length; j++) {
    const seg = segs[j];
    if (seg.font !== segs[start].font || seg.mode !== segs[start].mode || seg.text === null) return null;
    acc += strip(seg.text);
    if (acc === want) return j;
    if (!want.startsWith(acc)) return null;
  }
  return null;
}

interface Splice {
  s: number;
  e: number;
  text: string;
}

/**
 * Replaces text on one page. Returns one result per request. The page is modified only when at least one
 * request succeeded as "in-place" or "removed".
 */
export function replaceInPage(doc: PDFDocument, page: PDFPage, requests: ReplaceRequest[]): ReplaceResult[] {
  if (!requests.length) return [];
  const fail = (reason: string): ReplaceResult[] => requests.map((r) => ({ id: r.id, status: "not-found", reason }));

  const refs = contentRefs(doc, page);
  if (!refs?.length) return fail("page has no content stream");

  let data: Uint8Array;
  let ops: Op[];
  try {
    data = readContents(doc, refs);
    ops = parseContent(data);
  } catch {
    return fail("content stream could not be read");
  }

  const resources = page.node.Resources();
  const fontDict = resources?.lookupMaybe(PDFName.of("Font"), PDFDict);
  const fonts = new Map<string, FontInfo | null>();
  const fontFor = (name: string) => {
    if (!fonts.has(name)) {
      const d = fontDict?.lookupMaybe(PDFName.of(name), PDFDict);
      fonts.set(name, d ? buildFont(doc, d) : null);
    }
    return fonts.get(name)!;
  };

  const keyOf = (name: string) => {
    const raw = fontDict?.get(PDFName.of(name));
    return raw instanceof PDFRef ? raw.tag : `name:${name}`;
  };
  const { segs, used } = interpret(ops, (font, bytes) => fontFor(font)?.decode(bytes) ?? null, keyOf);

  const claimed = new Set<number>();
  const splices: Splice[] = [];
  const results: ReplaceResult[] = [];

  for (const req of requests) {
    const want = strip(req.text);
    if (!want) {
      results.push({ id: req.id, status: "not-found", reason: "original text is blank" });
      continue;
    }
    const near = (s: Seg) =>
      s.known && Math.abs(s.x - req.x) <= POSITION_TOLERANCE && Math.abs(s.y - req.y) <= POSITION_TOLERANCE;

    let primary: [number, number] | null = null;
    const duplicates: Array<[number, number]> = [];
    let sawInvisible = false;
    let sawUndecodable = false;
    let sawClaimed = false;
    for (let i = 0; i < segs.length; i++) {
      if (!near(segs[i])) continue;
      if (segs[i].text === null) sawUndecodable = true;
      const end = matchFrom(segs, i, want);
      if (end === null) continue;
      if (segs[i].mode === 3 || segs[i].mode === 7) {
        sawInvisible = true;
        continue;
      }
      const range: [number, number] = [i, end];
      let overlaps = false;
      for (let j = i; j <= end; j++) if (claimed.has(j)) overlaps = true;
      if (overlaps) {
        sawClaimed = true;
        continue;
      }
      if (!primary) primary = range;
      else duplicates.push(range); // text drawn twice at the same spot (fake bold, shadows)
      i = end;
    }

    if (!primary) {
      results.push({
        id: req.id,
        status: "not-found",
        reason: sawInvisible
          ? "text is an invisible (OCR) layer"
          : sawClaimed
            ? "overlaps another edit"
            : sawUndecodable
              ? "the font has no usable text encoding"
              : "text not found in the page content (it may be inside a form or image)",
      });
      continue;
    }

    const first = segs[primary[0]];
    const font = fontFor(first.font)!;
    const encoded = font.encode(req.replacement, used.get(keyOf(first.font)) ?? new Set());

    const ranges = [primary, ...duplicates];
    for (const [a, b] of ranges) for (let j = a; j <= b; j++) claimed.add(j);

    // Group matched strings by the TJ array they live in, so kerning numbers between them go away with them.
    const groups = new Map<object, Seg[]>();
    for (const [a, b] of ranges) {
      for (let j = a; j <= b; j++) {
        const key = segs[j].arr ?? segs[j].tok;
        groups.set(key, [...(groups.get(key) ?? []), segs[j]]);
      }
    }
    const firstSeg = segs[primary[0]];
    for (const group of groups.values()) {
      const carriesText = encoded !== null && group[0] === firstSeg;
      splices.push({
        s: group[0].tok.s,
        e: group[group.length - 1].tok.e,
        text: carriesText ? toHex(encoded!) : "<>",
      });
    }

    results.push(
      encoded
        ? { id: req.id, status: "in-place" }
        : {
            id: req.id,
            status: "removed",
            reason: "the original font lacks some of the new characters",
            style: font.style,
            fill: first.fill,
          },
    );
  }

  if (!splices.length) return results;

  // Assemble the new stream in a single pass (splices never overlap: each string belongs to one request).
  splices.sort((p, q) => p.s - q.s);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let at = 0;
  for (const sp of splices) {
    chunks.push(data.subarray(at, sp.s), enc.encode(sp.text));
    at = sp.e;
  }
  chunks.push(data.subarray(at));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  writeContents(doc, page, refs, out);
  return results;
}
