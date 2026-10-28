import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Modal } from "@/components/ui";
import type { PlacedImage } from "./images";

const WIDTH = 520;
const HEIGHT = 200;
const INK = "#1e1b4b";
const PAD = 6;

type Bounds = { x0: number; y0: number; x1: number; y1: number };

export default function SignaturePad({
  onCancel,
  onUse,
}: {
  onCancel: () => void;
  onUse: (signature: PlacedImage) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);

  useEffect(() => {
    const element = canvas.current!;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = WIDTH * ratio;
    element.height = HEIGHT * ratio;
    const context = element.getContext("2d")!;
    context.scale(ratio, ratio);
    context.strokeStyle = INK;
    context.fillStyle = INK;
    context.lineWidth = 3;
    context.lineCap = context.lineJoin = "round";
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * WIDTH, y: ((event.clientY - rect.top) / rect.height) * HEIGHT };
  };

  const draw = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const context = canvas.current!.getContext("2d")!;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    setBounds((b) => ({
      x0: Math.min(b?.x0 ?? to.x, to.x),
      y0: Math.min(b?.y0 ?? to.y, to.y),
      x1: Math.max(b?.x1 ?? to.x, to.x),
      y1: Math.max(b?.y1 ?? to.y, to.y),
    }));
  };

  const clear = () => {
    const element = canvas.current!;
    element.getContext("2d")!.clearRect(0, 0, WIDTH, HEIGHT);
    setBounds(null);
  };

  const use = () => {
    if (!bounds) return;
    const source = canvas.current!;
    const ratio = source.width / WIDTH;
    const x = Math.max(0, bounds.x0 - PAD);
    const y = Math.max(0, bounds.y0 - PAD);
    const w = Math.min(WIDTH, bounds.x1 + PAD) - x;
    const h = Math.min(HEIGHT, bounds.y1 + PAD) - y;
    const out = document.createElement("canvas");
    out.width = Math.round(w * ratio);
    out.height = Math.round(h * ratio);
    out.getContext("2d")!.drawImage(source, x * ratio, y * ratio, w * ratio, h * ratio, 0, 0, out.width, out.height);
    onUse({ src: out.toDataURL("image/png"), mime: "image/png", ratio: out.width / out.height });
  };

  return (
    <Modal titleId="signature-title" onClose={onCancel} className="max-w-xl">
      <h2 id="signature-title" className="text-2xl font-extrabold tracking-tight text-slate-950">
        Draw your signature
      </h2>
      <p className="mt-2 text-sm font-medium text-slate-500">
        Use your mouse, finger, or stylus. You can place it on any page afterwards.
      </p>
      <canvas
        ref={canvas}
        aria-label="Signature drawing area"
        className="mt-6 aspect-[13/5] w-full touch-none cursor-crosshair border border-dashed border-slate-300 bg-slate-50"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const p = point(event);
          last.current = p;
          draw(p, { x: p.x + 0.01, y: p.y });
        }}
        onPointerMove={(event) => {
          if (!last.current) return;
          const p = point(event);
          draw(last.current, p);
          last.current = p;
        }}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
      />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="text-sm font-bold text-slate-600 hover:text-slate-900 disabled:opacity-40"
          disabled={!bounds}
          onClick={clear}
        >
          Clear
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-indigo-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-800 disabled:opacity-40"
            disabled={!bounds}
            onClick={use}
          >
            Use signature
          </button>
        </div>
      </div>
    </Modal>
  );
}
