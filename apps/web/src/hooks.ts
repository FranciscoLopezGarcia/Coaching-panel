import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Revisión en vivo del atleta que el coach tiene abierto. El servidor sube la revisión de un atleta con CADA escritura que lo afecta
 * (también las que hace el atleta desde su portal). Mientras haya un atleta vigilado, se pregunta la revisión cada pocos segundos y al
 * volver a la pestaña; si cambió, `useLoad` vuelve a pedir lo que muestra, sin parpadeo y sin pisar datos idénticos.
 */
const POLL_MS = 4000;
let liveRev = 0;
let watched: { id: string; last: number | null; count: number } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function pollRev() {
  const w = watched;
  if (!w || document.visibilityState === 'hidden') return;
  try {
    const r = await fetch(`/api/athletes/${encodeURIComponent(w.id)}/rev`, { cache: 'no-store' });
    if (!r.ok || watched !== w) return;
    const rev = ((await r.json()) as { rev: number }).rev;
    if (w.last !== null && rev !== w.last) {
      liveRev += 1;
      emit();
    }
    w.last = rev;
  } catch {
    /* sin red: se reintenta en el próximo ciclo */
  }
}
const onVisible = () => void pollRev();

/** Vigila los cambios de un atleta mientras el componente esté montado. Devuelve la función que deja de vigilar. */
export function watchAthlete(id: string): () => void {
  if (watched?.id === id) watched.count += 1;
  else {
    watched = { id, last: null, count: 1 };
    void pollRev();
  }
  if (!timer) {
    timer = setInterval(() => void pollRev(), POLL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
  }
  const mine = watched;
  return () => {
    mine.count -= 1;
    if (mine.count > 0 || watched !== mine) return;
    watched = null;
    if (timer) clearInterval(timer);
    timer = null;
    window.removeEventListener('focus', onVisible);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => liveRev;

/** Descarta respuestas tardías y conserva datos durante recargas del mismo contexto. Se actualiza sola cuando el atleta vigilado cambia. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({
    data: null,
    error: '',
    loading: true,
  });
  const [revision, setRevision] = useState(0);
  const live = useSyncExternalStore(subscribe, snapshot);
  const context = JSON.stringify(deps);
  const previous = useRef(context);
  const previousLive = useRef(live);
  useEffect(() => {
    let active = true;
    const same = previous.current === context;
    // Recarga por cambio en vivo: mismo contexto, sin pantalla de carga y sin reemplazar datos que no cambiaron.
    const silent = same && previousLive.current !== live;
    previous.current = context;
    previousLive.current = live;
    if (!silent) setState((s) => ({ data: same ? s.data : null, error: '', loading: true }));
    fn()
      .then((data) => {
        if (!active) return;
        setState((s) =>
          silent && s.data !== null && JSON.stringify(s.data) === JSON.stringify(data)
            ? s
            : { data, error: '', loading: false },
        );
      })
      .catch((e: Error) => {
        if (active && !silent) setState((s) => ({ ...s, error: e.message, loading: false }));
      });
    return () => {
      active = false;
    };
  }, [...deps, revision, live]);
  return { ...state, reload: () => setRevision((x) => x + 1) };
}
