import { useEffect, useEffectEvent, useRef, type ReactNode, type Ref } from "react";

export type IconName =
  | "arrow"
  | "check"
  | "chevron"
  | "download"
  | "edit"
  | "highlight"
  | "image"
  | "lock"
  | "merge"
  | "minus"
  | "more"
  | "plus"
  | "redo"
  | "rotate"
  | "signature"
  | "text"
  | "trash"
  | "undo"
  | "upload";

const paths: Record<IconName, ReactNode> = {
  arrow: <path d="m9 18 6-6-6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  download: (
    <>
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 19h14" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </>
  ),
  highlight: <path d="m9 11-5 5 4 4 5-5m-4-4 8-8 4 4-8 8m-9 6h16" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 15-5-5L5 20" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  merge: (
    <>
      <path d="M7 3h7l4 4v6" />
      <path d="M14 3v5h5" />
      <path d="M17 21H8a2 2 0 0 1-2-2V7" />
      <path d="M12 13v6m-3-3h6" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  redo: <path d="M20 7v5h-5M4 17a8 8 0 0 1 14-5l2 2" />,
  rotate: (
    <>
      <path d="M20 11a8 8 0 1 0-2 6" />
      <path d="M20 4v7h-7" />
    </>
  ),
  signature: (
    <>
      <path d="M4 17c4-8 6-11 8-11 3 0-4 12-1 12 2 0 3-5 5-5 1 0 0 4 2 4 1 0 2-1 3-2" />
      <path d="M4 21h16" />
    </>
  ),
  text: (
    <>
      <path d="M5 5h14M12 5v14" />
      <path d="M8 19h8" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7" />
      <path d="M10 11v6m4-6v6" />
    </>
  ),
  undo: <path d="M4 7v5h5m11 5a8 8 0 0 0-14-5l-2 2" />,
  upload: (
    <>
      <path d="M12 16V4m0 0L7 9m5-5 5 5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
};

const sizes = { sm: "h-4 w-4", md: "h-5 w-5", lg: "h-7 w-7" };

export function Icon({ name, size = "md" }: { name: IconName; size?: keyof typeof sizes }) {
  return (
    <svg
      aria-hidden="true"
      className={sizes[size]}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-700 text-white">
        <span className="text-lg font-black">C</span>
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-sm border-2 border-white bg-amber-400" />
      </div>
      {!compact && (
        <span className="text-xl font-extrabold tracking-tight text-slate-950">
          Campi<span className="text-indigo-600">Go</span>
        </span>
      )}
    </div>
  );
}

/** Hidden PDF picker, opened programmatically through its ref. */
export function PdfInput({
  ref,
  multiple,
  onFiles,
}: {
  ref: Ref<HTMLInputElement>;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
}) {
  return (
    <input
      ref={ref}
      className="sr-only"
      type="file"
      accept="application/pdf,.pdf"
      multiple={multiple}
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        onFiles(Array.from(event.target.files ?? []));
        event.target.value = "";
      }}
    />
  );
}

/** Accessible modal: closes on Escape or backdrop click and restores focus afterwards. */
export function Modal({
  titleId,
  onClose,
  className = "max-w-md",
  children,
}: {
  titleId: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onMouseDown={(event) => event.currentTarget === event.target && onClose()}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full bg-white p-6 shadow-2xl outline-none md:p-8 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
