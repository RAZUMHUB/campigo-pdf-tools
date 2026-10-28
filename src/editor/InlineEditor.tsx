import { useLayoutEffect, useRef, type CSSProperties } from "react";

/**
 * Plain-text, in-place editor. Commits on blur (or Enter for single-line);
 * Escape cancels by committing `null`.
 */
export default function InlineEditor({
  initial,
  multiline,
  className = "",
  style,
  label,
  onCommit,
}: {
  initial: string;
  multiline?: boolean;
  className?: string;
  style?: CSSProperties;
  label: string;
  onCommit: (text: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const settled = useRef(false);

  useLayoutEffect(() => {
    const element = ref.current!;
    element.textContent = initial;
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Only on mount: later `initial` changes must not clobber what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label={label}
      aria-multiline={multiline}
      contentEditable="true"
      suppressContentEditableWarning
      spellCheck={false}
      className={`min-w-[1ch] cursor-text whitespace-pre outline-none focus:outline-none ${className}`}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => {
        event.stopPropagation();
        ref.current?.focus();
      }}
      onBlur={(event) => {
        // Removing a focused element can fire blur again in some browsers; commit only once.
        if (settled.current) return;
        settled.current = true;
        onCommit(cancelled.current ? null : event.currentTarget.innerText.replace(/\n$/, "").replaceAll("\u00a0", " "));
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        } else if (event.key === "Enter" && !multiline) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
