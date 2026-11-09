import { useEffect, useRef, useState } from 'react';
/** Descarta respuestas tardías y conserva datos durante recargas del mismo contexto. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({
    data: null,
    error: '',
    loading: true,
  });
  const [revision, setRevision] = useState(0);
  const context = JSON.stringify(deps);
  const previous = useRef(context);
  useEffect(() => {
    let active = true;
    const same = previous.current === context;
    previous.current = context;
    setState((s) => ({ data: same ? s.data : null, error: '', loading: true }));
    fn()
      .then((data) => {
        if (active) setState({ data, error: '', loading: false });
      })
      .catch((e: Error) => {
        if (active) setState((s) => ({ ...s, error: e.message, loading: false }));
      });
    return () => {
      active = false;
    };
  }, [...deps, revision]);
  return { ...state, reload: () => setRevision((x) => x + 1) };
}
