# CampiGo

Edit, sign, highlight, rotate, merge and convert PDFs to JPG. Everything runs in the browser — files are never uploaded.

React 19 · Vite · Tailwind CSS 4 · [pdf.js](https://mozilla.github.io/pdf.js/) (rendering) · [pdf-lib](https://pdf-lib.js.org/) (saving)

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # export + geometry unit tests
pnpm build        # typecheck + production build into dist/
pnpm preview
```

Node 20+ required. Copy `.env.example` to `.env` and set `VITE_SUPPORT_EMAIL` before publishing (shown on the Contact page).

## Deploy

`dist/` is a static site; any static host works. `public/_headers` (Netlify / Cloudflare Pages) sets a strict
Content-Security-Policy and long-lived caching for hashed assets — port it to your host's config if it
doesn't read that file. pdf.js fonts, CMaps and WASM decoders are served from `/pdfjs/` on your own origin.

## How editing works

| Tool | Result in the saved PDF |
| --- | --- |
| Edit | Clicking existing text paints over it with the sampled background and writes the new text on top (Helvetica, original size and ink colour). |
| Text / Highlight / Image / Sign | Drawn onto the page. Images are normalised to PNG/JPEG; signatures are drawn on a canvas. |
| Rotate | Adds to the page's own `/Rotate`. |
| Merge | Pages from every file, in the order shown in the sidebar. |

## Known limits

- **Replaced text is covered, not deleted** — the original stays in the file's text layer. Do not use this to redact.
- Replacement text supports Latin (Windows-1252) characters only; others are written as `?` and the user is warned.
- Password-protected PDFs are rejected with a clear message. Form fields are not preserved when merging.
- The account dialog is a local profile only (no password is stored or verified). Add a real backend before relying on it.
- Needs a current browser (`IntersectionObserver`, `createImageBitmap`, `contenteditable="plaintext-only"`).
