import { useRef, type CSSProperties, type PointerEvent } from "react";
import InlineEditor from "./InlineEditor";
import {
  HIGHLIGHT_COLOR,
  HIGHLIGHT_OPACITY,
  LINE_HEIGHT,
  toUnrotated,
  type Annotation,
  type TextAnnotation,
  type Tool,
} from "./model";

const MIN_SIZE = 8;
export const FONT_FAMILY = "Helvetica, Arial, sans-serif";

export const textStyle = (
  fontSize: number,
  color: string,
  scale: number,
  fontFamily = FONT_FAMILY,
): CSSProperties => ({
  fontFamily,
  fontSize: fontSize * scale,
  lineHeight: LINE_HEIGHT,
  color,
});

function useDrag<T>(
  begin: () => T,
  move: (origin: T, dx: number, dy: number, first: boolean) => void,
  end?: (moved: boolean) => void,
) {
  const state = useRef<{ x: number; y: number; origin: T; moved: boolean } | null>(null);
  const finish = () => {
    const current = state.current;
    state.current = null;
    if (current) end?.(current.moved);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      state.current = { x: event.clientX, y: event.clientY, origin: begin(), moved: false };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = state.current;
      if (!current) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (!current.moved && Math.hypot(dx, dy) < 3) return;
      move(current.origin, dx, dy, !current.moved);
      current.moved = true;
    },
    onPointerUp: finish,
    onPointerCancel: finish,
  };
}

export default function AnnotationView({
  annotation: a,
  scale,
  rotation,
  tool,
  selected,
  editing,
  onSelect,
  onChange,
  onEdit,
  onCommit,
}: {
  annotation: Annotation;
  scale: number;
  rotation: number;
  tool: Tool;
  selected: boolean;
  editing: boolean;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Annotation>, record: boolean) => void;
  onEdit: (id: string) => void;
  onCommit: (text: string | null) => void;
}) {
  // Screen-space drag distances → page points, accounting for how the page is turned.
  const toPoints = (dx: number, dy: number) => {
    const [x, y] = toUnrotated(dx, dy, rotation, 0, 0);
    return [x / scale, y / scale] as const;
  };

  const move = useDrag(
    () => {
      onSelect(a.id);
      return { x: a.x, y: a.y, cover: a.type === "text" ? a.cover : undefined };
    },
    (origin, dx, dy, first) => {
      const [x, y] = toPoints(dx, dy);
      const patch: Partial<TextAnnotation> = { x: origin.x + x, y: origin.y + y };
      if (origin.cover) patch.cover = { ...origin.cover, x: origin.cover.x + x, y: origin.cover.y + y };
      onChange(a.id, patch, first);
    },
    (moved) => {
      if (!moved && tool === "edit" && a.type === "text") onEdit(a.id);
    },
  );

  const resize = useDrag(
    () => ({ w: a.type === "text" ? 0 : a.w, h: a.type === "text" ? 0 : a.h }),
    (origin, dx, dy, first) => {
      const [x, y] = toPoints(dx, dy);
      const w = Math.max(MIN_SIZE, origin.w + x);
      const h = a.type === "image" ? w * (origin.h / origin.w) : Math.max(MIN_SIZE, origin.h + y);
      onChange(a.id, { w, h }, first);
    },
  );

  const outline = selected ? "outline outline-2 outline-indigo-500" : "hover:outline hover:outline-1 hover:outline-indigo-300";
  const position: CSSProperties = { left: a.x * scale, top: a.y * scale };

  if (a.type === "text") {
    return (
      <div
        className={`absolute touch-none ${editing ? "" : `cursor-move ${outline}`}`}
        style={position}
        {...(editing ? {} : move)}
        onClick={(event) => {
          event.stopPropagation();
          if (tool === "edit" && a.type === "text") onEdit(a.id);
        }}
      >
        {a.cover && (
          <div
            className="absolute"
            style={{
              left: (a.cover.x - a.x) * scale,
              top: (a.cover.y - a.y) * scale,
              width: a.cover.w * scale,
              height: a.cover.h * scale,
              background: a.cover.color,
              zIndex: 0,
              pointerEvents: "none",
            }}
          />
        )}
        {editing ? (
          <InlineEditor
            initial={a.text}
            multiline={!a.cover}
            label="Edit text"
            style={textStyle(a.fontSize, a.color, scale, a.fontFamily || FONT_FAMILY)}
            onCommit={onCommit}
          />
        ) : (
          <div className="relative z-10 whitespace-pre" style={textStyle(a.fontSize, a.color, scale, a.fontFamily || FONT_FAMILY)}>
            {a.text || "\u200b"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`absolute cursor-move touch-none ${outline}`}
      style={{ ...position, width: a.w * scale, height: a.h * scale }}
      {...move}
    >
      {a.type === "image" ? (
        <img src={a.src} alt="" draggable={false} className="h-full w-full select-none" />
      ) : (
        <div
          className="h-full w-full"
          style={{ backgroundColor: HIGHLIGHT_COLOR, opacity: HIGHLIGHT_OPACITY, mixBlendMode: "multiply" }}
        />
      )}
      {selected && (
        <div
          className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize touch-none rounded-sm border-2 border-white bg-indigo-600"
          aria-label="Resize"
          {...resize}
        />
      )}
    </div>
  );
}
