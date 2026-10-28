/**
 * Vertical padding (as a fraction of font size) added above and below an edited run's cover.
 * PDF.js run boxes are font-metric boxes and can be shorter than the real glyph extents (descenders, accents),
 * which is how slivers of the original text used to show next to an edit.
 */
export const COVER_PAD = 0.12;
