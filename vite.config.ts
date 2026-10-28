import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// pdf.js loads fonts, CMaps and WASM decoders on demand; serve them from our own origin.
const pdfjsAsset = (dir: string) => ({
  src: `node_modules/pdfjs-dist/${dir}/*`,
  dest: `pdfjs/${dir}`,
  rename: { stripBase: true as const },
});

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: ["cmaps", "standard_fonts", "wasm", "iccs"].map(pdfjsAsset),
    }),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  build: { chunkSizeWarningLimit: 900 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
