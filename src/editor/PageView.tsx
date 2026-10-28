import { useEffect, useRef, useState } from "react";
import { loadRuns, type PdfFile } from "@/lib/pdf";
import AnnotationView, { textStyle } from "./AnnotationView";
import { COVER_PAD } from "./cover";
import InlineEditor from "./InlineEditor";
import PageSurface, { useNearViewport } from "./PageSurface";
import {
  BASELINE,
  DEFAULT_FONT_SIZE,
  toUnrotated,
  type Annotation,
  type Editing,
  type PageInfo,
  type Rect,
  type TextRun,
  type Tool,
} from "./model";

export const pageDomId = (fileId: string, index: number) => `page-${fileId}-${index}`;

const MIN_HIGHLIGHT = 4;

/**
 * Samples the rendered page around a text run: its background (so the original can be painted over while editing)
 * and its ink (the pixel that contrasts most with that background).
 *
 * The background is the most common colour on a thin ring just outside the run's box. Looking at a ring rather
 * than one pixel keeps a stray glyph pixel, a table rule or a gradient edge from becoming the "background".
 */
function sampleRun(canvas: HTMLCanvasElement | null, run: TextRun, pageWidth: number) {
  const fallback = { background: "#ffffff", color: "#000000" };
  if (!canvas?.width) return fallback;

  const context = canvas.getContext("2d")!;
  const k = canvas.width / pageWidth; // canvas pixels per point
  const x = Math.max(0, Math.floor(run.x * k));
  const y = Math.max(0, Math.floor(run.y * k));
  const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(run.w * k)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(run.h * k)));

  // Ring: the 2px band just outside the box (clamped to the canvas).
  const ring = 2;
  const rx = Math.max(0, x - ring);
  const ry = Math.max(0, y - ring);
  const rw = Math.min(canvas.width - rx, w + (x - rx) + ring);
  const rh = Math.min(canvas.height - ry, h + (y - ry) + ring);
  const area = context.getImageData(rx, ry, rw, rh).data;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let py = 0; py < rh; py++) {
    for (let px = 0; px < rw; px++) {
      const inside = px >= x - rx && px < x - rx + w && py >= y - ry && py < y - ry + h;
      if (inside) continue;
      const i = (py * rw + px) * 4;
      if (!area[i + 3]) continue;
      const key = ((area[i] >> 3) << 10) | ((area[i + 1] >> 3) << 5) | (area[i + 2] >> 3);
      const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bucket.n++;
      bucket.r += area[i];
      bucket.g += area[i + 1];
      bucket.b += area[i + 2];
      buckets.set(key, bucket);
    }
  }
  let top: { n: number; r: number; g: number; b: number } | undefined;
  for (const bucket of buckets.values()) if (!top || bucket.n > top.n) top = bucket;
  if (!top) return fallback;
  const [br, bg, bb] = [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)];

  const { data } = context.getImageData(x, y, w, h);
  let ink = [0, 0, 0];
  let best = 0;
  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg) + Math.abs(data[i + 2] - bb);
    if (distance > best) {
      best = distance;
      ink = [data[i], data[i + 1], data[i + 2]];
    }
  }
  const hex = (rgb: number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const luminance = 0.299 * br + 0.587 * bg + 0.114 * bb;
  return { background: hex([br, bg, bb]), color: best > 60 ? hex(ink) : luminance < 115 ? "#ffffff" : "#000000" };
}

export default function PageView({
  file,
  index,
  info,
  scale,
  rotation,
  tool,
  annotations,
  selectedId,
  editing,
  armed,
  pageNumber,
  scrollRoot,
  onActivate,
  onSelect,
  onPoint,
  onHighlight,
  onRun,
  onChange,
  onEdit,
  onCommit,
}: {
  file: PdfFile;
  index: number;
  info: PageInfo;
  scale: number;
  rotation: number;
  tool: Tool;
  annotations: Annotation[];
  selectedId: string | null;
  editing: Editing | null;
  /** An image or signature is waiting to be placed. */
  armed: boolean;
  pageNumber: number;
  scrollRoot: HTMLElement | null;
  /** Must be referentially stable: it is an effect dependency. */
  onActivate: (pageNumber: number) => void;
  onSelect: (id: string | null) => void;
  onPoint: (point: { x: number; y: number }) => void;
  onHighlight: (rect: Rect) => void;
  onRun: (run: TextRun, sample: { background: string; color: string }) => void;
  onChange: (id: string, patch: Partial<Annotation>, record: boolean) => void;
  onEdit: (id: string) => void;
  onCommit: (text: string | null) => void;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const near = useNearViewport(wrapper);
  const [runs, setRuns] = useState<TextRun[] | null>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const width = info.width * scale;
  const height = info.height * scale;

  // The page crossing the middle of the viewport becomes the "current" page.
  useEffect(() => {
    const element = wrapper.current;
    if (!element || !scrollRoot) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && onActivate(pageNumber), {
      root: scrollRoot,
      rootMargin: "-50% 0px -50% 0px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot, onActivate, pageNumber]);

  // Existing text is only analysed once the Edit tool needs it, and only for pages in view.
  useEffect(() => {
    if (tool !== "edit" || !near || runs) return;
    let live = true;
    loadRuns(file.doc, index)
      .then((found) => live && setRuns(found))
      .catch(() => live && setRuns([]));
    return () => {
      live = false;
    };
  }, [tool, near, runs, file.doc, index]);

  /** Pointer position in points on the unrotated page, clamped to the page. */
  const toPoint = (event: { clientX: number; clientY: number }) => {
    const rect = outer.current!.getBoundingClientRect();
    const [x, y] = toUnrotated(event.clientX - rect.left, event.clientY - rect.top, rotation, width, height);
    return {
      x: Math.min(info.width, Math.max(0, x / scale)),
      y: Math.min(info.height, Math.max(0, y / scale)),
    };
  };

  const here = (e: { fileId: string; page: number }) => e.fileId === file.id && e.page === index;
  const editedRuns = new Set(
    annotations.flatMap((a) => (a.type === "text" && a.cover ? [a.cover.runKey] : [])),
  );
  const openRun = editing?.mode === "run" && here(editing) ? editing : null;
  const openNew = editing?.mode === "new" && here(editing) ? editing : null;

  const drawing = tool === "highlight";
  const placing = armed && (tool === "signature" || tool === "image");
  const cursor = tool === "text" ? "text" : drawing ? "crosshair" : placing ? "copy" : "default";

  return (
    <div ref={wrapper} id={pageDomId(file.id, index)} className="scroll-mt-4">
      <PageSurface
        doc={file.doc}
        index={index}
        info={info}
        scale={scale}
        rotation={rotation}
        outerRef={outer}
        canvasRef={canvas}
        className="shadow-xl"
      >
        <div
          className="absolute inset-0"
          style={{ cursor, touchAction: drawing ? "none" : undefined }}
          onPointerDown={(event) => {
            if (!drawing || event.target !== event.currentTarget) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const { x, y } = toPoint(event);
            setDraft({ x0: x, y0: y, x1: x, y1: y });
          }}
          onPointerMove={(event) => {
            if (!draft) return;
            const { x, y } = toPoint(event);
            setDraft({ ...draft, x1: x, y1: y });
          }}
          onPointerUp={() => {
            if (!draft) return;
            const rect = {
              x: Math.min(draft.x0, draft.x1),
              y: Math.min(draft.y0, draft.y1),
              w: Math.abs(draft.x1 - draft.x0),
              h: Math.abs(draft.y1 - draft.y0),
            };
            setDraft(null);
            if (rect.w >= MIN_HIGHLIGHT && rect.h >= MIN_HIGHLIGHT) onHighlight(rect);
          }}
          onPointerCancel={() => setDraft(null)}
          onClick={(event) => {
            if (event.target !== event.currentTarget || drawing) return;
            onActivate(pageNumber);
            if (tool === "text" || placing) onPoint(toPoint(event));
            else onSelect(null);
          }}
        >
          {tool === "edit" &&
            runs
              ?.filter((run) => !editedRuns.has(run.key) && openRun?.run.key !== run.key)
              .map((run) => (
                <button
                  type="button"
                  key={run.key}
                  title="Click to edit"
                  aria-label={`Edit text: ${run.str}`}
                  className="absolute cursor-text rounded-sm hover:bg-indigo-500/10 hover:outline hover:outline-2 hover:outline-indigo-300"
                  style={{
                    left: run.x * scale - 4,
                    top: run.y * scale - 6,
                    width: Math.max(run.w * scale + 8, 20),
                    height: Math.max(run.h * scale + 12, 28),
                    touchAction: "manipulation",
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRun(run, sampleRun(canvas.current, run, info.width));
                  }}
                />
              ))}

          {annotations.map((annotation) => (
            <AnnotationView
              key={annotation.id}
              annotation={annotation}
              scale={scale}
              rotation={rotation}
              tool={tool}
              selected={annotation.id === selectedId}
              editing={editing?.mode === "annotation" && editing.id === annotation.id}
              onSelect={onSelect}
              onChange={onChange}
              onEdit={onEdit}
              onCommit={onCommit}
            />
          ))}

          {openRun && (
            <>
              <div
                className="absolute"
                style={{
                  // Slightly larger than the PDF.js box so no sliver of the original glyphs (descenders, accents) shows.
                  left: (openRun.run.x - 1) * scale,
                  top: (openRun.run.y - openRun.run.fontSize * COVER_PAD) * scale,
                  width: (openRun.run.w + 2) * scale,
                  height: (openRun.run.h + 2 * openRun.run.fontSize * COVER_PAD) * scale,
                  background: openRun.background,
                }}
              />
              <div
                className="absolute"
                style={{ left: openRun.run.x * scale, top: (openRun.run.baseline - BASELINE * openRun.run.fontSize) * scale }}
              >
                <InlineEditor
                  initial={openRun.run.str}
                  label="Edit text"
                  style={textStyle(openRun.run.fontSize, openRun.color, scale)}
                  onCommit={onCommit}
                />
              </div>
            </>
          )}

          {openNew && (
            <div className="absolute" style={{ left: openNew.x * scale, top: openNew.y * scale }}>
              <InlineEditor multiline initial="" label="New text" style={textStyle(DEFAULT_FONT_SIZE, "#000000", scale)} onCommit={onCommit} />
            </div>
          )}

          {draft && (
            <div
              className="pointer-events-none absolute bg-yellow-300/60"
              style={{
                left: Math.min(draft.x0, draft.x1) * scale,
                top: Math.min(draft.y0, draft.y1) * scale,
                width: Math.abs(draft.x1 - draft.x0) * scale,
                height: Math.abs(draft.y1 - draft.y0) * scale,
              }}
            />
          )}
        </div>
      </PageSurface>
    </div>
  );
}
