import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import type { RenderTask } from "pdfjs-dist";
import type { PdfFile } from "@/lib/pdf";
import type { PageInfo } from "./model";

export function useNearViewport(ref: RefObject<Element | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "800px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return near;
}

/** Draws a page only while it is near the viewport, and releases the bitmap once it is far away. */
function PageCanvas({
  doc,
  index,
  scale,
  canvasRef,
}: {
  doc: PdfFile["doc"];
  index: number;
  scale: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const near = useNearViewport(canvasRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!near) {
      canvas.width = canvas.height = 0;
      return;
    }

    let cancelled = false;
    let task: RenderTask | undefined;
    void (async () => {
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale: scale * Math.min(window.devicePixelRatio || 1, 2) });
      if (cancelled) return;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport, background: "#fff" });
      await task.promise;
    })().catch((error: unknown) => {
      if ((error as Error)?.name !== "RenderingCancelledException") console.error(error);
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, index, scale, near, canvasRef]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}

/**
 * A page drawn at `scale` CSS px per point and turned clockwise by `rotation`.
 * Children are laid out in the page's own (unrotated) coordinate space, so they turn with it.
 */
export default function PageSurface({
  doc,
  index,
  info,
  scale,
  rotation,
  outerRef,
  canvasRef,
  className = "",
  children,
}: {
  doc: PdfFile["doc"];
  index: number;
  info: PageInfo;
  scale: number;
  rotation: number;
  outerRef?: Ref<HTMLDivElement>;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  className?: string;
  children?: ReactNode;
}) {
  const ownCanvas = useRef<HTMLCanvasElement>(null);
  const width = info.width * scale;
  const height = info.height * scale;
  const turned = rotation % 180 !== 0;

  return (
    <div
      ref={outerRef}
      className={`relative shrink-0 bg-white ${className}`}
      style={{ width: turned ? height : width, height: turned ? width : height }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{ width, height, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
      >
        <PageCanvas doc={doc} index={index} scale={scale} canvasRef={canvasRef ?? ownCanvas} />
        {children}
      </div>
    </div>
  );
}
