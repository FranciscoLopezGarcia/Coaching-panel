import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

interface Suggestion {
  action: 'subir_carga' | 'subir_reps' | 'mantener' | 'bajar_carga' | 'sin_datos';
  sets: { reps: number; kg: number | null }[];
  e1rm: number | null;
  fatigueDrop: number | null;
  lastSummary: string;
  rationale: string[];
}
interface Item {
  exposureId: string;
  exerciseName: string;
  suggestion: Suggestion;
}
interface Note {
  exerciseName: string;
  note: string;
  updatedAt: string;
}
const ACTION: Record<Suggestion['action'], string> = {
  subir_carga: '↑ Subir carga',
  subir_reps: '+ Repeticiones',
  mantener: '= Mantener',
  bajar_carga: '↓ Bajar carga',
  sin_datos: 'Sin datos',
};
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Avisa apenas el atleta (o cualquier cambio) toca algo de este atleta: SSE con respaldo de sondeo cada 5 s. */
export function useAthleteLive(id: string, onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let last: number | null = null;
    let stop = false;
    const seen = (rev: number) => {
      if (last !== null && rev !== last) cb.current();
      last = rev;
    };
    const poll = async () => {
      try {
        const r = await fetch(`/api/athletes/${encodeURIComponent(id)}/rev`, { cache: 'no-store' });
        if (r.ok) seen(((await r.json()) as { rev: number }).rev);
      } catch {
        /* sin red: se reintenta */
      }
    };
    const es = new EventSource(`/api/athletes/${encodeURIComponent(id)}/events`);
    es.addEventListener('rev', (e) => seen((JSON.parse((e as MessageEvent).data) as { rev: number }).rev));
    const t = setInterval(() => !stop && void poll(), 5000);
    void poll();
    return () => {
      stop = true;
      es.close();
      clearInterval(t);
    };
  }, [id]);
}

/**
 * Lo que solo ve el coach de una sesión: progresión sugerida por ejercicio (a partir de lo que el atleta hizo en el entreno anterior
 * del mismo ejercicio: 1RM estimado, caída entre series, RPE) y las notas que dejó el atleta. Nunca modifica el plan.
 */
export function ProgressionPanel({ id, sessionKey }: { id: string; sessionKey: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState<string>('');
  const load = useCallback(() => {
    const q = encodeURIComponent(sessionKey);
    get<{ items: Item[] }>(id, `progression?sessionKey=${q}`)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
    get<{ notes: Note[] }>(id, `notes?sessionKey=${q}`)
      .then((r) => setNotes(r.notes))
      .catch(() => undefined);
  }, [id, sessionKey]);
  useEffect(load, [load]);
  useAthleteLive(id, load);
  if (!items) return null;
  return (
    <section className="prog-panel">
      <h3>Progresión sugerida · solo la ves vos</h3>
      <p className="small muted">
        Sale de lo que hizo el atleta la última vez en cada ejercicio. Elegí en «Meta al atleta» si también la
        ve (solo repeticiones, o repeticiones y kg).
      </p>
      <table>
        <thead>
          <tr>
            <th>Ejercicio</th>
            <th>Último entreno</th>
            <th>1RM est.</th>
            <th>Caída entre series</th>
            <th>Sugerencia</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const s = it.suggestion;
            const first = s.sets[0];
            return (
              <tr key={it.exposureId} onClick={() => setOpen(open === it.exposureId ? '' : it.exposureId)}>
                <td>{it.exerciseName}</td>
                <td>{s.lastSummary || '—'}</td>
                <td>{s.e1rm ? `${fmt(s.e1rm)} kg` : '—'}</td>
                <td>
                  {s.fatigueDrop === null
                    ? '—'
                    : s.fatigueDrop === 0
                      ? 'sin caída'
                      : `−${s.fatigueDrop} reps`}
                </td>
                <td>
                  <b className={`prog-${s.action}`}>{ACTION[s.action]}</b>
                  {s.action !== 'sin_datos' && first && (
                    <span>
                      {' '}
                      {[...new Set(s.sets.map((x) => `${x.kg ? fmt(x.kg) + ' kg × ' : ''}${x.reps}`))].join(
                        ' · ',
                      )}
                    </span>
                  )}
                  {open === it.exposureId && (
                    <ul className="small muted">
                      {s.rationale.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {notes.length > 0 && (
        <div className="prog-notes">
          <h4>Notas del atleta</h4>
          {notes.map((n) => (
            <p key={n.exerciseName}>
              <b>{n.exerciseName}:</b> {n.note}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
