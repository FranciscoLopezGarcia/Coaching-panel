import type { ReactNode } from 'react';
export function Async<T>({
  state,
  children,
}: {
  state: { data: T | null; error: string; loading: boolean; reload?: () => void };
  children: (d: T) => ReactNode;
}) {
  if (state.error && state.data === null)
    return (
      <div className="message error" role="alert">
        No se pudo cargar: {state.error} {state.reload && <button onClick={state.reload}>Reintentar</button>}
      </div>
    );
  if (state.loading && state.data === null)
    return (
      <div className="loading" role="status">
        <span />
        Cargando información…
      </div>
    );
  if (state.data === null) return null;
  return (
    <>
      {state.error && (
        <p className="message error" role="alert">
          La recarga falló: {state.error} {state.reload && <button onClick={state.reload}>Reintentar</button>}
        </p>
      )}
      {children(state.data)}
    </>
  );
}
