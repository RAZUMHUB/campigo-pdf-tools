import { useCallback, useState } from "react";

type State<T> = { past: T[]; present: T; future: T[] };
type Next<T> = T | ((current: T) => T);

const MAX_STEPS = 100;
const resolve = <T,>(next: Next<T>, current: T) => (next instanceof Function ? next(current) : next);

/** Undo/redo state. `set` records a step; `replace` updates the present value without one (e.g. mid-drag). */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<State<T>>({ past: [], present: initial, future: [] });

  const set = useCallback(
    (next: Next<T>) =>
      setState((s) => ({ past: [...s.past, s.present].slice(-MAX_STEPS), present: resolve(next, s.present), future: [] })),
    [],
  );
  const replace = useCallback(
    (next: Next<T>) => setState((s) => ({ ...s, present: resolve(next, s.present) })),
    [],
  );
  const undo = useCallback(
    () =>
      setState((s) =>
        s.past.length ? { past: s.past.slice(0, -1), present: s.past.at(-1)!, future: [s.present, ...s.future] } : s,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setState((s) =>
        s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s,
      ),
    [],
  );
  /** Applies `fn` to every stored state, e.g. to drop edits that belong to a removed file. */
  const rewrite = useCallback(
    (fn: (value: T) => T) =>
      setState((s) => ({ past: s.past.map(fn), present: fn(s.present), future: s.future.map(fn) })),
    [],
  );

  return { present: state.present, canUndo: state.past.length > 0, canRedo: state.future.length > 0, set, replace, undo, redo, rewrite };
}
