import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { Brand } from "@/components/ui";
import type { Intent } from "@/editor/model";

export type ToolSlug =
  | "pdfmerge"
  | "pdfedit"
  | "pdftojpg"
  | "jpgtopdf"
  | "imgcompress"
  | "pdfcompress";

type ToolInfo = {
  title: string;
  description: string;
  heading: string;
  intro: string;
  steps: string[];
};

const tools: Record<ToolSlug, ToolInfo> = {
  pdfmerge: {
    title: "Merge PDF Files Online Free | CampiGo",
    description: "Combine multiple PDF files into one document with CampiGo.",
    heading: "Merge PDF files",
    intro: "Combine multiple PDF documents into one file in your browser.",
    steps: ["Select two or more PDFs.", "Review the selected documents.", "Export your combined PDF."],
  },
  pdfedit: {
    title: "Edit PDF Online Free | CampiGo",
    description: "Edit PDF documents online with CampiGo.",
    heading: "Edit a PDF",
    intro: "Open a PDF in the CampiGo editor to make supported changes.",
    steps: ["Choose a PDF.", "Make changes in the editor.", "Export your updated PDF."],
  },
  pdftojpg: {
    title: "Convert PDF to JPG Online | CampiGo",
    description: "Convert PDF pages to JPG images with CampiGo.",
    heading: "Convert PDF to JPG",
    intro: "Open a PDF in the CampiGo image-export workspace.",
    steps: ["Choose a PDF.", "Open the image-export workspace.", "Export pages as images."],
  },
  jpgtopdf: {
    title: "JPG to PDF Online Free | CampiGo",
    description: "Convert JPG and PNG images into one downloadable PDF in your browser.",
    heading: "JPG to PDF",
    intro: "Turn one or multiple JPG or PNG images into a single PDF document. Arrange images by selecting them in your preferred order.",
    steps: ["Select one or more JPG or PNG images.", "Images are fitted onto individual PDF pages.", "Download your new PDF."],
  },
  imgcompress: {
    title: "Compress Images Online Free | CampiGo",
    description: "Compress JPG, PNG and WebP images online with adjustable quality.",
    heading: "Compress Images",
    intro: "Reduce image file size using adjustable quality. Image conversion happens in your browser.",
    steps: ["Select JPG, PNG or WebP images.", "Choose a compression quality.", "Download the compressed images."],
  },
  pdfcompress: {
    title: "Compress PDF Online Free | CampiGo",
    description: "Try browser-based PDF optimization and compare the original and output file sizes.",
    heading: "Compress PDF",
    intro: "Try optimizing a PDF in your browser and compare file sizes. PDFs containing already-compressed images may not shrink further.",
    steps: ["Choose a PDF file.", "Run browser-based PDF optimization.", "Compare sizes and download the result."],
  },
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function safeBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-") || "campigo";
}

async function compressImage(file: File, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare this image.");
    context.drawImage(bitmap, 0, 0);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, type === "image/jpeg" ? quality : undefined)
    );
    if (!blob) throw new Error(`Could not compress ${file.name}.`);
    return blob;
  } finally {
    bitmap.close();
  }
}


async function compressImageToTarget(
  file: File,
  targetBytes: number,
  startingQuality: number
): Promise<Blob> {
  const qualities = [startingQuality, 0.8, 0.65, 0.5, 0.35, 0.2]
    .filter((q, i, arr) => q > 0 && arr.indexOf(q) === i)
    .sort((a, b) => b - a);

  let best: Blob | null = null;

  for (const quality of qualities) {
    const blob = await compressImage(file, quality);

    if (!best || Math.abs(blob.size - targetBytes) < Math.abs(best.size - targetBytes)) {
      best = blob;
    }

    if (blob.size <= targetBytes) return blob;
  }

  if (!best) throw new Error(`Could not compress ${file.name}.`);
  return best;
}

async function imagesToPdf(files: File[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = file.type.toLowerCase();
    let image;
    if (type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) {
      image = await pdf.embedJpg(bytes);
    } else if (type === "image/png" || /\.png$/i.test(file.name)) {
      image = await pdf.embedPng(bytes);
    } else {
      throw new Error(`${file.name}: please use JPG or PNG images.`);
    }

    const maxWidth = 595.28;
    const maxHeight = 841.89;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    const page = pdf.addPage([maxWidth, maxHeight]);
    page.drawImage(image, {
      x: (maxWidth - width) / 2,
      y: (maxHeight - height) / 2,
      width,
      height,
    });
  }

  return pdf.save();
}

export default function ToolLanding({
  slug,
  onFiles,
  busy,
  error,
}: {
  slug: ToolSlug;
  onFiles: (files: File[], intent: Intent) => void;
  busy: boolean;
  error: string | null;
}) {
  const tool = tools[slug];
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [quality, setQuality] = useState(0.7);
  const [targetValue, setTargetValue] = useState("200");
  const [targetUnit, setTargetUnit] = useState<"KB" | "MB">("KB");
  const [targetEnabled, setTargetEnabled] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState("");
  const [sizes, setSizes] = useState<{ before: number; after: number } | null>(null);
  const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
  const canonical = `https://campigo.in/${slug}`;

  useEffect(() => {
    document.title = tool.title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = tool.description;

    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "canonical";
      document.head.appendChild(link);
    }
    link.href = canonical;
  }, [tool, canonical]);

  const processFiles = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    setFailure("");
    setMessage("");
    setSizes(null);
    setResult(null);

    if (slug === "pdfmerge" || slug === "pdfedit" || slug === "pdftojpg") {
      if (files.some((file) => file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
        setFailure("Please select PDF files only.");
        return;
      }
      if (slug === "pdfmerge" && files.length < 2) {
        setFailure("Please select at least two PDF files to merge.");
        return;
      }
      onFiles(files, slug === "pdftojpg" ? "images" : "edit");
      return;
    }

    setProcessing(true);
    try {
      if (slug === "jpgtopdf") {
        if (files.some((file) => !/^image\/(jpeg|png)$/i.test(file.type) && !/\.(jpe?g|png)$/i.test(file.name))) {
          throw new Error("Please select JPG or PNG images only.");
        }
        const pdfBytes = await imagesToPdf(files);
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const name = files.length === 1 ? `${safeBaseName(files[0].name)}.pdf` : "campigo-images.pdf";
        setResult({ blob, name });
        setSizes({ before: files.reduce((sum, file) => sum + file.size, 0), after: blob.size });
        setMessage(`${files.length} image(s) added to your PDF.`);
      } else if (slug === "imgcompress") {
        const outputFiles: { blob: Blob; name: string }[] = [];
        let totalBefore = 0;
        let totalAfter = 0;
        const targetBytes = targetEnabled
          ? Number(targetValue) * (targetUnit === "MB" ? 1024 * 1024 : 1024)
          : null;

        if (targetEnabled && (!Number.isFinite(targetBytes) || targetBytes! <= 0)) {
          throw new Error("Enter a valid target size greater than zero.");
        }

        for (const file of files) {
          if (!file.type.startsWith("image/")) {
            throw new Error(`${file.name} is not a supported image.`);
          }

          const perImageTarget = targetBytes === null ? null : targetBytes / files.length;
          const blob = perImageTarget === null
            ? await compressImage(file, quality)
            : await compressImageToTarget(file, perImageTarget, quality);

          const ext = blob.type === "image/png" ? "png" : "jpg";
          outputFiles.push({
            blob,
            name: `${safeBaseName(file.name)}-compressed.${ext}`,
          });
          totalBefore += file.size;
          totalAfter += blob.size;
        }

        if (outputFiles.length === 1) {
          setResult(outputFiles[0]);
        } else {
          for (const output of outputFiles) downloadBlob(output.blob, output.name);
        }

        setSizes({ before: totalBefore, after: totalAfter });

        const reduction = totalBefore > 0
          ? ((1 - totalAfter / totalBefore) * 100).toFixed(1)
          : "0.0";

        if (targetBytes !== null && totalAfter > targetBytes) {
          setMessage(
            `Target not reached. Output: ${formatBytes(totalAfter)}; target: ${formatBytes(targetBytes)}. Size reduction: ${reduction}%.`
          );
        } else if (targetBytes !== null) {
          setMessage(
            `Target met. Output: ${formatBytes(totalAfter)}; size reduction: ${reduction}%.`
          );
        } else if (totalAfter < totalBefore) {
          setMessage(`Image compression reduced the total size by ${reduction}%.`);
        } else {
          setMessage("The output is not smaller. This image may already be optimized.");
        }
      } else if (slug === "pdfcompress") {
        if (files.length !== 1) throw new Error("Please choose one PDF at a time.");

        const original = files[0];
        const document = await PDFDocument.load(await original.arrayBuffer());
        const bytes = await document.save({ useObjectStreams: true });
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });

        const targetBytes = targetEnabled
          ? Number(targetValue) * (targetUnit === "MB" ? 1024 * 1024 : 1024)
          : null;

        if (targetEnabled && (!Number.isFinite(targetBytes) || targetBytes! <= 0)) {
          throw new Error("Enter a valid target size greater than zero.");
        }

        setResult({ blob, name: `${safeBaseName(original.name)}-optimized.pdf` });
        setSizes({ before: original.size, after: blob.size });

        if (targetBytes !== null && blob.size <= targetBytes) {
          setMessage(`Target met. Output: ${formatBytes(blob.size)}.`);
        } else if (targetBytes !== null) {
          setMessage(
            `Target not reached. Output: ${formatBytes(blob.size)}; target: ${formatBytes(targetBytes)}. This basic PDF optimizer cannot guarantee a target size.`
          );
        } else {
          setMessage(
            blob.size < original.size
              ? "PDF optimization reduced the file size."
              : "This PDF did not get smaller. Browser optimization cannot recompress every embedded image or remove all existing data."
          );
        }
      }
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "Could not process these files.");
    } finally {
      setProcessing(false);
    }
  };

  const isImageTool = slug === "jpgtopdf" || slug === "imgcompress";
  const accept = isImageTool ? "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" : ".pdf,application/pdf";
  const multiple = slug === "pdfmerge" || slug === "jpgtopdf" || slug === "imgcompress";
  const specialized = slug === "jpgtopdf" || slug === "imgcompress" || slug === "pdfcompress";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
          <a href="/" aria-label="CampiGo home"><Brand /></a>
          <a href="/" className="text-sm font-bold text-indigo-700 hover:text-indigo-900">All PDF tools</a>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-10 md:px-8 md:py-16 lg:grid-cols-[1fr_0.85fr] lg:gap-16">
        <div className="self-center">
          <p className="text-sm font-extrabold uppercase tracking-widest text-indigo-700">CampiGo PDF tools</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-black tracking-tight md:text-5xl">{tool.heading}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">{tool.intro}</p>

          <div className="mt-7 flex flex-wrap gap-4 text-sm font-semibold text-slate-600">
            <span>✓ Free to use</span><span>✓ Files stay on your device</span><span>✓ No account required</span>
          </div>

          <div className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            {slug === "imgcompress" && (
              <div className="mb-5">
                <label htmlFor="quality" className="flex justify-between text-sm font-bold">
                  <span>JPEG quality</span><span>{Math.round(quality * 100)}%</span>
                </label>
                <input id="quality" type="range" min="0.2" max="0.95" step="0.05" value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="mt-3 w-full accent-indigo-700" />
                <p className="mt-1 text-xs text-slate-500">PNG files remain PNG; quality control applies to JPEG output.</p>
              </div>
            )}

            {(slug === "imgcompress" || slug === "pdfcompress") && (
              <section className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={targetEnabled}
                    onChange={(event) => setTargetEnabled(event.target.checked)}
                    className="h-4 w-4 accent-indigo-700"
                  />
                  Aim for a target file size
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[100, 200, 500].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setTargetValue(String(value));
                        setTargetUnit("KB");
                        setTargetEnabled(true);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:border-indigo-500"
                    >
                      {value} KB
                    </button>
                  ))}
                  {[1, 2, 5].map((value) => (
                    <button
                      key={`${value}MB`}
                      type="button"
                      onClick={() => {
                        setTargetValue(String(value));
                        setTargetUnit("MB");
                        setTargetEnabled(true);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:border-indigo-500"
                    >
                      {value} MB
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <label htmlFor="target-size" className="sr-only">Target file size</label>
                  <input
                    id="target-size"
                    type="number"
                    min="1"
                    step="1"
                    value={targetValue}
                    onChange={(event) => {
                      setTargetValue(event.target.value);
                      setTargetEnabled(true);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    placeholder="Enter target size"
                  />
                  <label htmlFor="target-unit" className="sr-only">Size unit</label>
                  <select
                    id="target-unit"
                    value={targetUnit}
                    onChange={(event) => {
                      setTargetUnit(event.target.value as "KB" | "MB");
                      setTargetEnabled(true);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                  >
                    <option value="KB">KB</option>
                    <option value="MB">MB</option>
                  </select>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  This is a target, not a guaranteed size. Results depend on the file and supported compression.
                </p>
              </section>
            )}

            <input
              ref={inputRef}
              type="file"
              accept={accept}
              multiple={multiple}
              className="sr-only"
              onChange={(event) => {
                if (event.currentTarget.files) void processFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy || processing}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => { event.preventDefault(); setDragging(false); void processFiles(event.dataTransfer.files); }}
              className={`flex min-h-52 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 py-8 text-center transition ${dragging ? "border-indigo-600 bg-indigo-50" : "border-indigo-200 bg-indigo-50/50 hover:border-indigo-500 hover:bg-indigo-50"} disabled:cursor-wait disabled:opacity-60`}
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-700 text-2xl font-black text-white">↑</span>
              <span className="mt-4 text-lg font-extrabold">{processing ? "Processing files…" : busy ? "Opening your files…" : specialized ? "Choose files to process" : "Choose files"}</span>
              <span className="mt-2 text-sm text-slate-500">
                {slug === "jpgtopdf" ? "Multiple JPG or PNG images accepted" : slug === "imgcompress" ? "JPG, PNG or WebP images accepted" : multiple ? "Select multiple PDF files" : "Choose one PDF file"}
              </span>
              <span className="mt-4 rounded-lg bg-indigo-700 px-5 py-3 text-sm font-bold text-white">Browse files</span>
            </button>

            {(error || failure) && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{failure || error}</p>}
            {message && <p role="status" className="mt-4 rounded-lg bg-indigo-50 p-3 text-sm font-semibold text-indigo-900">{message}</p>}
            {sizes && (
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-100 p-3">
                  <p className="text-slate-500">Input size</p>
                  <p className="mt-1 font-extrabold">{formatBytes(sizes.before)}</p>
                </div>
                <div className="rounded-lg bg-slate-100 p-3">
                  <p className="text-slate-500">Output size</p>
                  <p className="mt-1 font-extrabold">{formatBytes(sizes.after)}</p>
                </div>
                <div className="rounded-lg bg-slate-100 p-3">
                  <p className="text-slate-500">{sizes.before >= sizes.after ? "Size saved" : "Extra size"}</p>
                  <p className="mt-1 font-extrabold">
                    {formatBytes(Math.abs(sizes.before - sizes.after))}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-100 p-3">
                  <p className="text-slate-500">{sizes.before >= sizes.after ? "Size reduced" : "Size increased"}</p>
                  <p className="mt-1 font-extrabold">
                    {sizes.before > 0
                      ? `${Math.abs((1 - sizes.after / sizes.before) * 100).toFixed(1)}%`
                      : "0.0%"}
                  </p>
                </div>
              </div>
            )}
            {result && (
              <button type="button" onClick={() => downloadBlob(result.blob, result.name)} className="mt-4 w-full rounded-lg bg-indigo-700 px-5 py-3 font-bold text-white hover:bg-indigo-800">
                Download {result.name}
              </button>
            )}
            <p className="mt-4 text-xs leading-5 text-slate-500">Files are processed locally in your browser. Keep your original files as a backup.</p>
          </div>
        </div>

        <aside className="self-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <h2 className="text-xl font-extrabold">How it works</h2>
          <ol className="mt-6 space-y-5">
            {tool.steps.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-black text-indigo-800">{index + 1}</span>
                <span className="pt-1 leading-6 text-slate-600">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-8 border-t border-slate-200 pt-6">
            <h3 className="font-extrabold">More CampiGo tools</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm font-bold">
              <a className="rounded-lg bg-slate-100 p-3 hover:bg-indigo-50 hover:text-indigo-700" href="/pdfmerge">Merge PDF ↗</a>
              <a className="rounded-lg bg-slate-100 p-3 hover:bg-indigo-50 hover:text-indigo-700" href="/pdfedit">Edit PDF ↗</a>
              <a className="rounded-lg bg-slate-100 p-3 hover:bg-indigo-50 hover:text-indigo-700" href="/pdftojpg">PDF to JPG ↗</a>
              <a className="rounded-lg bg-slate-100 p-3 hover:bg-indigo-50 hover:text-indigo-700" href="/jpgtopdf">JPG to PDF ↗</a>
              <a className="rounded-lg bg-slate-100 p-3 hover:bg-indigo-50 hover:text-indigo-700" href="/imgcompress">Image Compress ↗</a>
              <a className="rounded-lg bg-slate-100 p-3 hover:bg-indigo-50 hover:text-indigo-700" href="/pdfcompress">PDF Compress ↗</a>
            </div>
          </div>
        </aside>
      </section>
      <footer className="border-t border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-500">
        © {new Date().getFullYear()} CampiGo · PDF tools for everyday document work
      </footer>
    </main>
  );
}
