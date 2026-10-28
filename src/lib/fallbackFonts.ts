/**
 * Unicode fallback fonts for edited text that the original PDF font (or the standard PDF fonts) cannot draw.
 * Noto Sans is licensed under the SIL Open Font License 1.1, which permits embedding in PDFs.
 * Files are fetched lazily the first time an export needs them, so they cost nothing for ordinary sessions.
 *
 * Requires:  npm i @fontsource/noto-sans @fontsource/noto-sans-devanagari @pdf-lib/fontkit regenerator-runtime
 */
import latin400 from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url";
import latinExt400 from "@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff?url";
import deva400 from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url";
import latin700 from "@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url";
import latinExt700 from "@fontsource/noto-sans/files/noto-sans-latin-ext-700-normal.woff?url";
import deva700 from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff?url";
import type { FallbackFontLoader } from "./export";

// Order matters: the first font that has a glyph for a character draws it.
const FILES = {
  regular: [latin400, latinExt400, deva400],
  bold: [latin700, latinExt700, deva700],
};

const cache = new Map<boolean, Promise<ArrayBuffer[]>>();

export const loadFallbackFonts: FallbackFontLoader = (bold) => {
  let files = cache.get(bold);
  if (!files) {
    files = Promise.all(
      FILES[bold ? "bold" : "regular"].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load font ${url}`);
        return response.arrayBuffer();
      }),
    );
    // Do not cache failures: a retry (e.g. after reconnecting) should be able to succeed.
    files.catch(() => cache.delete(bold));
    cache.set(bold, files);
  }
  return files;
};
