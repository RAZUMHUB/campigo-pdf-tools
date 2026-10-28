import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { zipSync } from "fflate";
import { Brand, Icon, PdfInput, type IconName } from "@/components/ui";
import { exportPdf, unsupportedAfterFallback, type EditReport } from "@/lib/export";
import { loadFallbackFonts } from "@/lib/fallbackFonts";
import { saveBlob } from "@/lib/download";
import { isPdf } from "@/lib/files";
import { useHistory } from "@/lib/history";
import { closePdf, loadRuns, openPdfs, renderJpgs, type PdfFile } from "@/lib/pdf";
import { COVER_PAD } from "./cover";
import { loadImage, type PlacedImage } from "./images";
import PageSurface from "./PageSurface";
import PageView, { pageDomId } from "./PageView";
import SignaturePad from "./SignaturePad";
import {
  BASELINE,
  DEFAULT_FONT_SIZE,
  pageKey,
  uid,
  type Annotation,
  type Editing,
  type Edits,
  type Intent,
  type PageInfo,
  type Rect,
  type TextRun,
  type Tool,
} from "./model";

const TOOLS: Array<{ id: Tool; icon: IconName; label: string }> = [
  { id: "edit", icon: "edit", label: "Edit" },
  { id: "text", icon: "text", label: "Text" },
  { id: "signature", icon: "signature", label: "Sign" },
  { id: "image", icon: "image", label: "Image" },
  { id: "highlight", icon: "highlight", label: "Highlight" },
];

const NOTES: Record<Tool, string> = {
  edit: "Click any text to start editing",
  text: "Tap anywhere on the page to add text",
  signature: "Tap the page to place your signature",
  image: "Choose an image, then tap the page to place it",
  highlight: "Drag over the page to highlight",
};

const PX_PER_POINT = 96 / 72;
const MIN_ZOOM = 40;
const MAX_ZOOM = 150;
const THUMB_BOX = { w: 168, h: 224 };

const thumbScale = (info: PageInfo, rotation: number) => {
  const turned = rotation % 180 !== 0;
  const w = turned ? info.height : info.width;
  const h = turned ? info.width : info.height;
  return Math.min(THUMB_BOX.w / w, THUMB_BOX.h / h);
};

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type FindResult = {
  fileId: string;
  page: number;
  run: TextRun;
  count: number;
  segments: Array<{ run: TextRun; start: number; end: number }>;
  matchText: string;
};

/** Tells the user, honestly, how their text edits were applied. Returns null when everything was exact. */
function exportSummary(reports: EditReport[], missing: string[]) {
  const overlays = reports.filter((r) => r.mode === "overlay").length;
  const redrawn = reports.filter((r) => r.mode === "redrawn").length;
  const parts: string[] = [];
  if (overlays) {
    parts.push(
      `${overlays} edit${overlays > 1 ? "s" : ""} couldn’t be matched to the original text, so ${overlays > 1 ? "they were" : "it was"} placed on top of it (the original text is still in the file).`,
    );
  }
  if (redrawn) {
    parts.push(`${redrawn} edit${redrawn > 1 ? "s use" : " uses"} a substitute font because the original font lacks the new characters.`);
  }
  if (missing.length) parts.push(`Some characters (${missing.slice(0, 6).join(" ")}) can’t be drawn and appear as “?”.`);
  return parts.length ? parts.join(" ") : null;
}

/** Zoom that fits the first page to the viewport on small screens, otherwise the 82% default. */
function initialZoom(first: PageInfo) {
  const wide = window.innerWidth >= 768;
  const available = window.innerWidth - (wide ? 224 + 80 : 40);
  const fit = Math.floor((available / (first.width * PX_PER_POINT)) * 10) * 10;
  return Math.min(82, Math.max(MIN_ZOOM, fit));
}

export default function Editor({
  initialFiles,
  intent,
  onClose,
}: {
  initialFiles: PdfFile[];
  intent: Intent;
  onClose: () => void;
}) {
  const [files, setFiles] = useState(initialFiles);
  const history = useHistory<Edits>({ annotations: [], rotations: {} });
  const edits = history.present;

  const [tool, setTool] = useState<Tool>(intent === "sign" ? "signature" : "edit");
  const [zoom, setZoom] = useState(() => initialZoom(initialFiles[0].pages[0]));
  const [note, setNote] = useState(intent === "sign" ? "Draw your signature to continue" : NOTES.edit);
  const [current, setCurrent] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pending, setPending] = useState<PlacedImage | null>(null);
  const [signature, setSignature] = useState<PlacedImage | null>(null);
  const [padOpen, setPadOpen] = useState(intent === "sign");
  const [menuOpen, setMenuOpen] = useState(intent === "images");
  const [busy, setBusy] = useState<"pdf" | "jpg" | null>(null);
  const [saved, setSaved] = useState(false);
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [findResults, setFindResults] = useState<FindResult[]>([]);
  const [findIndex, setFindIndex] = useState(0);
  const [findBusy, setFindBusy] = useState(false);


  const addInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const scale = (zoom / 100) * PX_PER_POINT;
  const pages = useMemo(
    () => files.flatMap((file) => file.pages.map((info, index) => ({ file, index, info, key: pageKey(file.id, index) }))),
    [files],
  );
  const currentPage = Math.min(current, pages.length - 1);
  const selected = edits.annotations.find((a) => a.id === selectedId);
  const hasEdits = edits.annotations.length > 0 || Object.values(edits.rotations).some(Boolean);
  const dirty = hasEdits || files.length > 1;
  const baseName = files.length > 1 ? "merged" : files[0].file.name.replace(/\.pdf$/i, "");


  const searchPdfText = async () => {
    const query = findText.trim();
    if (!query) {
      setFindResults([]);
      setFindIndex(0);
      setNote("Enter text to search.");
      return;
    }

    setFindBusy(true);
    try {
      const results: FindResult[] = [];

      const needle = matchCase ? query : query.toLocaleLowerCase();

      for (const file of files) {
        for (let page = 0; page < file.pages.length; page++) {
          const runs = await loadRuns(file.doc, page);
          const ordered = [...runs].sort((a, b) =>
            Math.abs(a.y - b.y) > 3 ? a.y - b.y : a.x - b.x
          );

          const offsets: Array<{ run: TextRun; start: number; end: number }> = [];
          let combined = "";

          for (const run of ordered) {
            if (combined) combined += " ";
            const start = combined.length;
            // Raw run text: match offsets are later used to index run.str, so it must not be altered here.
            combined += run.str;
            offsets.push({ run, start, end: combined.length });
          }

          const haystack = matchCase ? combined : combined.toLocaleLowerCase();
          let offset = 0;

          while ((offset = haystack.indexOf(needle, offset)) !== -1) {
            const end = offset + needle.length;
            const segments = offsets
              .filter((part) => part.end > offset && part.start < end)
              .map((part) => ({
                run: part.run,
                start: Math.max(0, offset - part.start),
                end: Math.min(part.run.str.length, end - part.start),
              }))
              .filter((part) => part.end > part.start);

            if (segments.length) {
              results.push({
                fileId: file.id,
                page,
                run: segments[0].run,
                count: 1,
                segments,
                matchText: combined.slice(offset, end),
              });
            }

            offset = end;
          }
        }
      }

      setFindResults(results);
      setFindIndex(0);
      setNote(
        results.length
          ? `Found ${results.length} match(es)`
          : "No matches found in selectable PDF text"
      );
    } catch (error) {
      setNote(errorMessage(error, "Could not search this PDF"));
    } finally {
      setFindBusy(false);
    }
  };

  const goToFindResult = (index: number) => {
    if (!findResults.length) return;
    const next = (index + findResults.length) % findResults.length;
    setFindIndex(next);
    const result = findResults[next];
    const pageIndex = pages.findIndex((p) => p.file.id === result.fileId && p.index === result.page);
    if (pageIndex >= 0) setCurrent(pageIndex);
    window.setTimeout(() => {
      document.getElementById(pageDomId(result.fileId, result.page))?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 50);
  };

  /** The annotation CampiGo creates when an existing text run is edited. `source` lets export edit the page content itself. */
  const runEditAnnotation = (fileId: string, page: number, run: TextRun, text: string, color: string, background: string): Annotation => {
    const pad = run.fontSize * COVER_PAD;
    return {
      id: uid("a"),
      type: "text",
      fileId,
      page,
      x: run.x,
      y: run.baseline - BASELINE * run.fontSize,
      fontSize: run.fontSize,
      color,
      text,
      fontFamily: run.fontFamily,
      cover: {
        x: run.x - 1,
        y: run.y - pad,
        w: run.w + 2,
        h: run.h + 2 * pad,
        color: background,
        original: run.str,
        runKey: run.key,
        source: { x: run.x, baseline: run.baseline, text: run.str },
      },
    };
  };

  const replaceFindResult = (all: boolean) => {
    if (!findText.trim() || !findResults.length) return;

    const targets = all ? findResults : [findResults[findIndex]];
    const additions: Annotation[] = [];
    let skipped = 0;

    // Matches inside a single text run become ONE in-place edit of that run (several hits in a run are combined).
    const perRun = new Map<string, { result: FindResult; hits: Array<{ start: number; end: number }> }>();
    const alreadyEdited = new Set(
      edits.annotations.flatMap((a) => (a.type === "text" && a.cover ? [`${a.fileId}:${a.page}:${a.cover.runKey}`] : [])),
    );

    for (const result of targets) {
      const { fileId, page, segments, matchText } = result;
      if (!segments.length) continue;

      if (segments.length === 1) {
        const [{ run, start, end }] = segments;
        const key = `${fileId}:${page}:${run.key}`;
        if (alreadyEdited.has(key)) {
          skipped++; // the search saw the run's original text; it has since been edited
          continue;
        }
        const entry = perRun.get(key) ?? { result, hits: [] };
        entry.hits.push({ start, end });
        perRun.set(key, entry);
        continue;
      }

      // A match that spans several runs cannot be edited in place; it keeps the overlay behaviour.
      const first = segments[0];
      const last = segments[segments.length - 1];

      // Avoid a large white cover across multiple lines or columns.
      const top = Math.min(...segments.map((part) => part.run.y));
      const bottom = Math.max(...segments.map((part) => part.run.y + part.run.h));
      const maxFont = Math.max(...segments.map((part) => part.run.fontSize));

      if (bottom - top > maxFont * 1.8) {
        skipped++;
        continue;
      }

      const firstLength = Math.max(1, first.run.str.length);
      const lastLength = Math.max(1, last.run.str.length);
      const left = first.run.x + (first.start / firstLength) * first.run.w;
      const right = last.run.x + (last.end / lastLength) * last.run.w;

      if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) {
        skipped++;
        continue;
      }

      additions.push({
        id: uid("a"),
        type: "text",
        fileId,
        page,
        x: left,
        y: first.run.baseline - BASELINE * first.run.fontSize,
        fontSize: first.run.fontSize,
        color: "#000000",
        text: replaceText,
        fontFamily: first.run.fontFamily,
        cover: {
          x: left,
          y: top,
          w: right - left,
          h: bottom - top,
          color: "#ffffff",
          original: matchText,
          runKey: first.run.key,
          // no `source`: export cannot locate a multi-run phrase in the page content
        },
      });
    }

    for (const { result, hits } of perRun.values()) {
      const run = result.segments[0].run;
      let text = run.str;
      for (const { start, end } of [...hits].sort((a, b) => b.start - a.start)) {
        text = text.slice(0, start) + replaceText + text.slice(end);
      }
      warnIfUnsupported(text);
      // The background is only used for the on-screen preview and the overlay fallback; export edits the real text.
      additions.push(runEditAnnotation(result.fileId, result.page, run, text, "#000000", "#ffffff"));
    }

    if (additions.length) {
      history.set((e) => ({ ...e, annotations: [...e.annotations, ...additions] }));
      setSelectedId(null);
      setNote(
        `Replaced ${additions.length} text run${additions.length > 1 ? "s" : ""}${skipped ? ` (${skipped} skipped)` : ""}. Download applies it to the PDF’s own text where possible.`,
      );
      setFindResults([]);
      setFindIndex(0);
    } else {
      setNote(skipped ? "Those matches are already edited or span several lines. Try a shorter phrase." : "No safe replacement found.");
    }
  };

  // ── Annotation helpers ────────────────────────────────────────────────

  const add = (annotation: Annotation, select = true) => {
    history.set((e) => ({ ...e, annotations: [...e.annotations, annotation] }));
    // Edits of existing text are not auto-selected: a selection frame around the line looked like a stray border.
    setSelectedId(select ? annotation.id : null);
  };

  const patch = (id: string, changes: Partial<Annotation>, record: boolean) =>
    (record ? history.set : history.replace)((e) => ({
      ...e,
      annotations: e.annotations.map((a) => (a.id === id ? ({ ...a, ...changes } as Annotation) : a)),
    }));

  const remove = (id: string) => {
    history.set((e) => ({ ...e, annotations: e.annotations.filter((a) => a.id !== id) }));
    setSelectedId(null);
  };

  const warnIfUnsupported = (text: string) =>
    unsupportedAfterFallback(text) && setNote("Some characters can’t be drawn by the available fonts and will appear as “?”.");

  const commitText = (text: string | null) => {
    const open = editing;
    setEditing(null);
    if (!open || text === null) return;

    if (open.mode === "new") {
      if (!text.trim()) return;
      warnIfUnsupported(text);
      add({
        id: uid("a"),
        type: "text",
        fileId: open.fileId,
        page: open.page,
        x: open.x,
        y: open.y,
        fontSize: DEFAULT_FONT_SIZE,
        color: "#000000",
        text,
      });
    } else if (open.mode === "run") {
      const { run, color, background } = open;
      if (text === run.str) return;

      warnIfUnsupported(text);
      add(runEditAnnotation(open.fileId, open.page, run, text, color, background), false);
    } else {
      const annotation = edits.annotations.find((a) => a.id === open.id);
      if (annotation?.type !== "text") return;
      // Putting the original text back removes the edit; emptying a plain text box removes the box.
      if (annotation.cover ? text === annotation.cover.original : !text.trim()) return remove(annotation.id);
      if (text !== annotation.text) {
        warnIfUnsupported(text);
        patch(annotation.id, { text }, true);
      }
    }
  };

  const place = (page: (typeof pages)[number], point: { x: number; y: number }) => {
    if (tool === "text") {
      setEditing({ mode: "new", fileId: page.file.id, page: page.index, x: point.x, y: point.y - DEFAULT_FONT_SIZE / 2 });
      return;
    }
    if (!pending) return;
    const w = Math.min(tool === "signature" ? 160 : 240, page.info.width * 0.5);
    const h = w / pending.ratio;
    add({
      id: uid("a"),
      type: "image",
      fileId: page.file.id,
      page: page.index,
      x: Math.max(0, Math.min(page.info.width - w, point.x - w / 2)),
      y: Math.max(0, Math.min(page.info.height - h, point.y - h / 2)),
      w,
      h,
      src: pending.src,
      mime: pending.mime,
    });
    setPending(null);
    setNote(tool === "signature" ? "Signature placed. Drag to move, or use the corner to resize." : "Image placed.");
  };

  const highlight = (page: (typeof pages)[number], rect: Rect) =>
    add({ id: uid("a"), type: "highlight", fileId: page.file.id, page: page.index, ...rect });

  const startRun = (page: (typeof pages)[number], run: TextRun, sample: { background: string; color: string }) => {
    setSelectedId(null);
    setEditing({ mode: "run", fileId: page.file.id, page: page.index, run, ...sample });
  };

  const resizeText = (delta: number) => {
    if (selected?.type !== "text") return;
    const fontSize = Math.min(96, Math.max(6, selected.fontSize + delta));
    // Replacement text keeps its baseline so it stays aligned with the original line.
    const y = selected.cover ? selected.y + BASELINE * (selected.fontSize - fontSize) : selected.y;
    patch(selected.id, { fontSize, y }, true);
  };

  // ── Tools ─────────────────────────────────────────────────────────────

  const selectTool = (next: Tool) => {
    setEditing(null);
    setSelectedId(null);
    setTool(next);
    setNote(NOTES[next]);
    if (next !== "signature" && next !== "image") setPending(null);

    if (next === "image") {
      imageInput.current?.click();
    } else if (next === "signature") {
      // First click arms the last signature; clicking again while armed draws a new one.
      if (signature && !(tool === "signature" && pending)) {
        setPending(signature);
      } else {
        setPadOpen(true);
        setNote("Draw your signature to continue");
      }
    }
  };

  const useSignature = (next: PlacedImage) => {
    setSignature(next);
    setPending(next);
    setPadOpen(false);
    setNote(NOTES.signature);
  };

  const pickImage = async (picked: File[]) => {
    if (!picked[0]) return;
    try {
      setPending(await loadImage(picked[0]));
      setNote("Tap the page to place your image");
    } catch (error) {
      setNote(errorMessage(error, "That image couldn’t be loaded."));
    }
  };

  const rotatePage = () => {
    const page = pages[currentPage];
    history.set((e) => ({ ...e, rotations: { ...e.rotations, [page.key]: ((e.rotations[page.key] ?? 0) + 90) % 360 } }));
    setNote(`Page ${currentPage + 1} rotated`);
  };

  // ── Files ─────────────────────────────────────────────────────────────

  const addFiles = async (picked: File[]) => {
    const pdfs = picked.filter(isPdf);
    if (!pdfs.length) return picked.length > 0 && setNote("Choose PDF files to add.");
    try {
      setNote("Adding files…");
      const opened = await openPdfs(pdfs);
      setFiles((all) => [...all, ...opened]);
      setNote(`Added ${opened.length === 1 ? opened[0].file.name : `${opened.length} files`}`);
    } catch (error) {
      setNote(errorMessage(error, "Those files couldn’t be added."));
    }
  };

  const moveFile = (from: number, step: -1 | 1) =>
    setFiles((all) => {
      const to = from + step;
      if (to < 0 || to >= all.length) return all;
      const next = [...all];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });

  const removeFile = (file: PdfFile) => {
    setFiles((all) => all.filter((f) => f.id !== file.id));
    history.rewrite((e) => ({
      annotations: e.annotations.filter((a) => a.fileId !== file.id),
      rotations: Object.fromEntries(Object.entries(e.rotations).filter(([key]) => !key.startsWith(`${file.id}:`))),
    }));
    setSelectedId(null);
    setEditing(null);
    void closePdf(file);
  };

  const goToPage = (key: string) => document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" });

  // ── Export ────────────────────────────────────────────────────────────

  const download = async () => {
    if (busy) return;
    setBusy("pdf");
    try {
      const unchanged = files.length === 1 && !hasEdits;
      const reports: EditReport[] = [];
      let missing: string[] = [];
      const blob = unchanged
        ? files[0].file
        : new Blob(
            [
              await exportPdf(files, edits, {
                fallbackFonts: loadFallbackFonts,
                onReport: (report) => reports.push(report),
                onMissingGlyphs: (chars) => (missing = chars),
              }),
            ],
            { type: "application/pdf" },
          );
      saveBlob(blob, files.length > 1 ? "CampiGo-merged.pdf" : `CampiGo-${files[0].file.name}`);
      const summary = exportSummary(reports, missing);
      if (summary) setNote(summary);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (error) {
      console.error(error);
      setNote("Something went wrong while creating the PDF. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const downloadJpgs = async () => {
    setMenuOpen(false);
    if (busy) return;
    setBusy("jpg");
    try {
      const images = await renderJpgs(await exportPdf(files, edits, { fallbackFonts: loadFallbackFonts }), (done, total) =>
        setNote(`Rendering page ${done} of ${total}…`),
      );
      if (images.length === 1) {
        saveBlob(images[0], `${baseName}.jpg`);
      } else {
        const digits = String(images.length).length;
        const entries = await Promise.all(
          images.map(async (image, i) => [
            `${baseName}-page-${String(i + 1).padStart(digits, "0")}.jpg`,
            new Uint8Array(await image.arrayBuffer()),
          ]),
        );
        // JPEGs are already compressed, so the archive just stores them.
        saveBlob(new Blob([zipSync(Object.fromEntries(entries), { level: 0 }) as BlobPart]), `CampiGo-${baseName}-images.zip`);
      }
      setNote(images.length === 1 ? "JPG downloaded" : `${images.length} JPGs downloaded as a ZIP`);
    } catch (error) {
      console.error(error);
      setNote("Something went wrong while creating the images. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without downloading?")) return;
    files.forEach((file) => void closePdf(file));
    onClose();
  };

  // ── Global behaviour ──────────────────────────────────────────────────

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    } else if (mod && key === "y") {
      event.preventDefault();
      history.redo();
    } else if ((key === "delete" || key === "backspace") && selectedId) {
      event.preventDefault();
      remove(selectedId);
    } else if (key === "escape") {
      setSelectedId(null);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: Event) => {
      if (event.type === "keydown" ? (event as KeyboardEvent).key === "Escape" : !menu.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, [menuOpen]);

  const status = busy ? "Preparing…" : dirty ? "Unsaved changes" : "No changes yet";

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-4">
          <button type="button" className="shrink-0" onClick={close} title="Back to home" aria-label="Back to home">
            <Brand compact />
          </button>
          <div className="hidden h-7 w-px bg-slate-200 sm:block" />
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-slate-800">
              {files[0].file.name}
              {files.length > 1 && ` + ${files.length - 1} more`}
            </p>
            <p className={`text-xs font-semibold ${dirty && !busy ? "text-amber-600" : "text-slate-400"}`}>{status}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="hidden rounded-xl px-3 py-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent sm:block"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="hidden rounded-xl px-3 py-2 text-slate-500 transition hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent sm:block"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <Icon name="redo" />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-md shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70"
            disabled={busy !== null}
            onClick={download}
          >
            <Icon name={saved ? "check" : "download"} size="sm" />
            {busy === "pdf" ? "Preparing…" : saved ? "Ready!" : "Download"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">
              {files.length > 1 ? "Files" : "Pages"}
            </span>
            <button
              type="button"
              className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50"
              onClick={() => addInput.current?.click()}
              title="Add PDF"
              aria-label="Add PDF"
            >
              <Icon name="plus" size="sm" />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-auto p-4">
            {files.length > 1
              ? files.map((file, i) => (
                  <div key={file.id}>
                    <button
                      type="button"
                      className="relative block w-full"
                      onClick={() => goToPage(pageDomId(file.id, 0))}
                      aria-label={`Go to ${file.file.name}`}
                    >
                      <div className="relative mx-auto w-fit rounded-lg border-2 border-indigo-500 bg-white shadow-sm">
                        <PageSurface doc={file.doc} index={0} info={file.pages[0]} scale={thumbScale(file.pages[0], 0)} rotation={0} className="rounded-md" />
                        <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-black text-white">
                          {i + 1}
                        </span>
                      </div>
                    </button>
                    <p className="mt-2 truncate text-center text-xs font-bold text-slate-500">{file.file.name}</p>
                    <p className="text-center text-xs font-medium text-slate-400">
                      {file.pages.length} {file.pages.length === 1 ? "page" : "pages"}
                    </p>
                    <div className="mt-1 flex justify-center gap-1 text-slate-500">
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"
                        disabled={i === 0}
                        onClick={() => moveFile(i, -1)}
                        title="Move up"
                        aria-label={`Move ${file.file.name} up`}
                      >
                        <span className="block rotate-180">
                          <Icon name="chevron" size="sm" />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"
                        disabled={i === files.length - 1}
                        onClick={() => moveFile(i, 1)}
                        title="Move down"
                        aria-label={`Move ${file.file.name} down`}
                      >
                        <Icon name="chevron" size="sm" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-rose-50 hover:text-rose-600"
                        onClick={() => removeFile(file)}
                        title="Remove"
                        aria-label={`Remove ${file.file.name}`}
                      >
                        <Icon name="trash" size="sm" />
                      </button>
                    </div>
                  </div>
                ))
              : pages.map((page, i) => {
                  const rotation = edits.rotations[page.key] ?? 0;
                  return (
                    <button
                      type="button"
                      key={page.key}
                      className="block w-full"
                      onClick={() => goToPage(pageDomId(page.file.id, page.index))}
                      aria-label={`Go to page ${i + 1}`}
                      aria-current={i === currentPage}
                    >
                      <div
                        className={`relative mx-auto w-fit rounded-lg border-2 bg-white shadow-sm ${
                          i === currentPage ? "border-indigo-500" : "border-slate-200"
                        }`}
                      >
                        <PageSurface
                          doc={page.file.doc}
                          index={page.index}
                          info={page.info}
                          scale={thumbScale(page.info, rotation)}
                          rotation={rotation}
                          className="rounded-md"
                        />
                        <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-black text-white">
                          {i + 1}
                        </span>
                      </div>
                    </button>
                  );
                })}
          </div>
          <div className="border-t border-slate-100 p-3">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-xs font-extrabold text-slate-600 hover:bg-slate-50"
              onClick={() => addInput.current?.click()}
            >
              <Icon name="plus" size="sm" /> Add PDF
            </button>
          </div>
        </aside>
        <PdfInput ref={addInput} multiple onFiles={addFiles} />
        <input
          ref={imageInput}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            void pickImage(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-16 shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 md:justify-center">
            {TOOLS.map(({ id, icon, label }) => (
              <Fragment key={id}>
                <button
                  type="button"
                  aria-pressed={tool === id}
                  className={`flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                    tool === id ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                  }`}
                  onClick={() => selectTool(id)}
                >
                  <Icon name={icon} />
                  {label}
                </button>
                {id === "edit" && (
                  <button
                    type="button"
                    aria-pressed={findOpen}
                    onClick={() => setFindOpen((open) => !open)}
                    title="Find and replace text"
                    className={`flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-extrabold transition ${
                      findOpen ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                    }`}
                  >
                    <Icon name="edit" />
                    Find & Replace
                  </button>
                )}
              </Fragment>
            ))}

            <button
              type="button"
              className="flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-extrabold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
              title="Rotate the current page"
              onClick={rotatePage}
            >
              <Icon name="rotate" />
              Rotate
            </button>
          </div>

          {findOpen && (
            <div className="shrink-0 border-b border-slate-200 bg-white p-4">
              <div className="mx-auto grid w-full max-w-4xl grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <input
                  value={findText}
                  onChange={(event) => setFindText(event.target.value)}
                  placeholder="Find text"
                  aria-label="Find text"
                  className="col-span-2 min-w-0 w-full rounded-lg border border-slate-300 px-3 py-3 text-base outline-none focus:border-indigo-500 sm:col-span-1 sm:min-w-36 sm:flex-1 sm:py-2 sm:text-sm"
                />
                <input
                  value={replaceText}
                  onChange={(event) => setReplaceText(event.target.value)}
                  placeholder="Replace with"
                  aria-label="Replace with"
                  className="col-span-2 min-w-0 w-full rounded-lg border border-slate-300 px-3 py-3 text-base outline-none focus:border-indigo-500 sm:col-span-1 sm:min-w-36 sm:flex-1 sm:py-2 sm:text-sm"
                />
                <button type="button" disabled={findBusy || !findText} onClick={() => void searchPdfText()} className="min-h-11 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40 sm:w-auto">
                  {findBusy ? "Searching…" : "Find"}
                </button>
                <button type="button" disabled={!findResults.length} onClick={() => goToFindResult(findIndex - 1)} className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-40 sm:w-auto">
                  Previous
                </button>
                <button type="button" disabled={!findResults.length} onClick={() => goToFindResult(findIndex + 1)} className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-40 sm:w-auto">
                  Next
                </button>
                <button type="button" disabled={!findResults.length} onClick={() => replaceFindResult(false)} className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-40 sm:w-auto">
                  Replace
                </button>
                <button type="button" disabled={!findResults.length} onClick={() => replaceFindResult(true)} className="min-h-11 w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-40 sm:w-auto">
                  Replace All
                </button>
                <label className="col-span-2 flex min-h-11 items-center gap-2 text-base text-slate-600 sm:col-span-1 sm:text-sm">
                  <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
                  Match case
                </label>
              </div>
              <p className="mx-auto mt-2 max-w-4xl text-xs text-slate-500">
                {findResults.length
                  ? `${findResults.reduce((n, r) => n + r.count, 0)} match(es) in ${findResults.length} text run(s)`
                  : "Searches selectable PDF text. Hyperlink destinations are not changed."}
                {" "}Text is replaced in the page content where possible. This is not secure redaction.
              </p>
            </div>
          )}

          <div ref={setScrollRoot} className="relative flex-1 overflow-auto bg-slate-200/70 p-5 md:p-10">
            <div className="pointer-events-none sticky top-3 z-20 mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3">
              <div
                role="status"
                className="pointer-events-auto rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-lg"
              >
                {note}
              </div>
              <div className="pointer-events-auto flex items-center gap-2">
                {selected && (
                  <div className="flex items-center gap-1 rounded-lg bg-white p-1 text-slate-600 shadow-sm">
                    {selected.type === "text" && (
                      <>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs font-black hover:bg-slate-100"
                          title="Smaller text"
                          aria-label="Smaller text"
                          onClick={() => resizeText(-1)}
                        >
                          A−
                        </button>
                        <button
                          type="button"
                          className="rounded px-2 py-1 text-xs font-black hover:bg-slate-100"
                          title="Larger text"
                          aria-label="Larger text"
                          onClick={() => resizeText(1)}
                        >
                          A+
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-rose-50 hover:text-rose-600"
                      title="Delete (Del)"
                      aria-label="Delete selection"
                      onClick={() => remove(selected.id)}
                    >
                      <Icon name="trash" size="sm" />
                    </button>
                  </div>
                )}
                <div ref={menu} className="relative">
                  <button
                    type="button"
                    className="rounded-lg bg-white p-2 text-slate-500 shadow-sm"
                    title="More options"
                    aria-label="More options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                  >
                    <Icon name="more" />
                  </button>
                  {menuOpen && (
                    <div role="menu" className="absolute right-0 top-full mt-2 w-60 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          setMenuOpen(false);
                          void download();
                        }}
                      >
                        <Icon name="download" size="sm" /> Download as PDF
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        autoFocus
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-50"
                        onClick={() => void downloadJpgs()}
                      >
                        <Icon name="image" size="sm" /> Download pages as JPG
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mx-auto flex w-max flex-col items-center gap-6">
              {pages.map((page, i) => (
                <PageView
                  key={page.key}
                  file={page.file}
                  index={page.index}
                  info={page.info}
                  scale={scale}
                  rotation={edits.rotations[page.key] ?? 0}
                  tool={tool}
                  annotations={edits.annotations.filter((a) => a.fileId === page.file.id && a.page === page.index)}
                  selectedId={selectedId}
                  editing={editing}
                  armed={pending !== null}
                  pageNumber={i}
                  scrollRoot={scrollRoot}
                  onActivate={setCurrent}
                  onSelect={setSelectedId}
                  onPoint={(point) => place(page, point)}
                  onHighlight={(rect) => highlight(page, rect)}
                  onRun={(run, sample) => startRun(page, run, sample)}
                  onChange={patch}
                  onEdit={(id) => {
                    setSelectedId(id);
                    setEditing({ mode: "annotation", id });
                  }}
                  onCommit={commitText}
                />
              ))}
            </div>
          </div>

          <div className="flex h-14 shrink-0 items-center justify-center gap-3 border-t border-slate-200 bg-white">
            <button
              type="button"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 10))}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <Icon name="minus" size="sm" />
            </button>
            <span className="w-12 text-center text-xs font-black text-slate-600">{zoom}%</span>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 10))}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <Icon name="plus" size="sm" />
            </button>
            <div className="mx-2 h-5 w-px bg-slate-200" />
            <span className="text-xs font-bold text-slate-400">
              Page {currentPage + 1} of {pages.length}
            </span>
          </div>
        </section>
      </div>

      {padOpen && (
        <SignaturePad
          onCancel={() => {
            setPadOpen(false);
            setNote(NOTES.edit);
            setTool("edit");
          }}
          onUse={useSignature}
        />
      )}
    </main>
  );
}
