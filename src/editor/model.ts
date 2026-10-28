export type Tool = "edit" | "text" | "signature" | "image" | "highlight";

export type Rect = { x: number; y: number; w: number; h: number };

/** Geometry of one page at scale 1, in PDF points. `width`/`height` are the upright (displayed) size. */
export type PageInfo = {
  width: number;
  height: number;
  /** The page's own /Rotate entry (0, 90, 180, 270). */
  rotate: number;
  /** Visible box in PDF user space: [x0, y0, x1, y1]. */
  view: [number, number, number, number];
};

/** What the exporter needs to know about a loaded PDF. */
export type PdfSource = { id: string; file: File; pages: PageInfo[] };

/**
 * Annotation coordinates are in points on the upright page, origin top-left,
 * i.e. the same space pdf.js renders into at scale 1.
 */
type Base = { id: string; fileId: string; page: number };

export type TextAnnotation = Base & {
  type: "text";
  /** Top-left of the text box. */
  x: number;
  y: number;
  fontSize: number;
  color: string;
  text: string;
  /** Detected source font family when replacing existing PDF text. */
  fontFamily?: string;
  /** Set when this replaces existing page text: the original is painted over first. */
  cover?: Rect & {
    color: string;
    original: string;
    runKey: string;
    source?: { x: number; baseline: number; text: string };
  };
};
export type HighlightAnnotation = Base & Rect & { type: "highlight" };
export type ImageAnnotation = Base &
  Rect & { type: "image"; src: string; mime: "image/png" | "image/jpeg" };

export type Annotation = TextAnnotation | HighlightAnnotation | ImageAnnotation;

export type Edits = {
  annotations: Annotation[];
  /** Extra clockwise rotation per page, keyed by `pageKey`. */
  rotations: Record<string, number>;
};

/** A run of existing page text that can be replaced (from pdf.js). */
export type TextRun = {
  key: string;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  baseline: number;
  fontSize: number;
  fontFamily?: string;
};

/** The text box currently open for typing. */
export type Editing =
  | { mode: "new"; fileId: string; page: number; x: number; y: number }
  | { mode: "annotation"; id: string }
  | { mode: "run"; fileId: string; page: number; run: TextRun; background: string; color: string };

export const LINE_HEIGHT = 1.2;
/** Distance from the top of a text line box to its baseline, in em. */
export const BASELINE = 0.95;
export const DEFAULT_FONT_SIZE = 14;
export const HIGHLIGHT_COLOR = "#ffeb3b";
export const HIGHLIGHT_OPACITY = 0.6;

export const pageKey = (fileId: string, page: number) => `${fileId}:${page}`;

let counter = 0;
export const uid = (prefix: string) => `${prefix}${++counter}`;

/**
 * Maps a point (or, with w = h = 0, a delta) measured on a page that is displayed
 * rotated clockwise by `rot` back to the unrotated page. `w`/`h` are the unrotated size.
 */
export function toUnrotated(u: number, v: number, rot: number, w: number, h: number): [number, number] {
  switch (rot) {
    case 90:
      return [v, h - u];
    case 180:
      return [w - u, h - v];
    case 270:
      return [w - v, u];
    default:
      return [u, v];
  }
}

/** Maps upright page coordinates (top-left origin) to PDF user space for a page with its own /Rotate. */
export function toUserSpace(info: PageInfo, x: number, y: number): [number, number] {
  const [x0, y0, x1, y1] = info.view;
  switch (info.rotate) {
    case 90:
      return [x0 + y, y0 + x];
    case 180:
      return [x1 - x, y0 + y];
    case 270:
      return [x1 - y, y1 - x];
    default:
      return [x0 + x, y1 - y];
  }
}

/** Which landing-page tool the user came in through. */
export type Intent = "edit" | "sign" | "images";
