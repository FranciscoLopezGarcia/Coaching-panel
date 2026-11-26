import { useState, type DragEvent, type KeyboardEvent } from 'react';
import type { SessionRow } from '@coaching/contracts';
import { dateLabel, Message, number } from './ui';
import { RpeChip } from '../components/RpeChip';
import { groupByExercise, isoWeekday, protocolText, type SetRow } from './sessionText';
import { applyAll, previewAll, type RunItem } from './programRun';
import './sessionorder.css';
import { matchesPrio, matchesRole, PriorityBadge, RoleBadge, usePrio, useRole } from './PriorityFilter';

const WD = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const weekday = (d: string) => WD[new Date(d + 'T12:00:00Z').getUTCDay()];
const EX = 'application/x-coaching-exercise';
const SES = 'application/x-coaching-session';
/** «3/3 series» o «2/3 series · 1 omitida»: cuánto de lo previsto se cargó de verdad. */
function executedSummary(sets: SetRow[]): string {
  const done = sets.filter((x) => x.actual?.status === 'done').length;
  const skipped = sets.filter((x) => x.actual?.status === 'skipped').length;
  return `${done}/${sets.length} series${skipped ? ` · ${skipped} omitida${skipped > 1 ? 's' : ''}` : ''}`;
}
/** Mueve `item` a la posición de `target` (si no están o son iguales, devuelve la lista sin cambios). */
function moveTo<T>(list: T[], item: T, target: T): T[] {
  const from = list.indexOf(item);
  const to = list.indexOf(target);
  if (from < 0 || to < 0 || from === to) return list;
  const out = list.filter((x) => x !== item);
  out.splice(to, 0, item);
  return out;
}

/**
 * Tarjetas chicas para ver una semana de un vistazo: «Sesión N · fecha» y debajo, una línea por ejercicio con su protocolo.
 * Un clic en la tarjeta abre la edición; «Registrar» lleva a cargar la ejecución. Nada más.
 */
export function SessionCards({
  id,
  sessions,
  mode,
  selectedKey,
  onEdit,
  onRecord,
  onChanged,
}: {
  id: string;
  sessions: SessionRow[];
  mode: string;
  selectedKey?: string;
  onEdit: (s: SessionRow) => void;
  onRecord: (s: SessionRow) => void;
  /** Se llamó a la API y el plan cambió: el padre recarga. */
  onChanged: (msg: string) => void;
}) {
  const [prio] = usePrio();
  const [role] = useRole();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState('');
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.dayNo - b.dayNo);

  const run = async (items: RunItem[], label: string, done: string) => {
    if (busy || !items.length) return;
    setBusy(true);
    setError('');
    try {
      const reviewed = await previewAll(id, items, label);
      await applyAll(id, reviewed, label);
      onChanged(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setOver('');
    }
  };
  /** Orden completo de la sesión (sin filtros) con `name` movido a la posición de `target`. */
  const reorderExercises = (s: SessionRow, name: string, target: string) => {
    const full = groupByExercise(s.sets).map((g) => g.name);
    const order = moveTo(full, name, target);
    if (order === full) return;
    void run(
      [{ label: 'Ordenar ejercicios', op: { type: 'reorder_exercises', sessionKey: s.sessionKey, order } }],
      'Orden de ejercicios (arrastrar)',
      'Orden de ejercicios guardado.',
    );
  };
  /** Las sesiones conservan el mismo conjunto de fechas; cambia cuál va en cada una. */
  const reorderSessions = (key: string, target: string) => {
    const keys = ordered.map((x) => x.sessionKey);
    const next = moveTo(keys, key, target);
    if (next === keys) return;
    const dates = ordered.map((x) => x.date);
    const byKey = new Map(ordered.map((x) => [x.sessionKey, x]));
    const items: RunItem[] = [];
    next.forEach((k, i) => {
      const date = dates[i]!;
      if (byKey.get(k)!.date === date) return;
      items.push({
        label: `Mover ${k}`,
        op: { type: 'move_session', sessionKey: k, plannedDate: date, dayNo: isoWeekday(date) },
      });
    });
    void run(items, 'Distribución de la semana (arrastrar)', 'Distribución de la semana guardada.');
  };
  const dropOn = (e: DragEvent, type: string, handle: (from: string) => void) => {
    if (!e.dataTransfer.types.includes(type)) return;
    e.preventDefault();
    e.stopPropagation();
    handle(e.dataTransfer.getData(type));
  };
  const keyMove = (e: KeyboardEvent, list: string[], item: string, apply: (t: string) => void) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    e.stopPropagation();
    const i = list.indexOf(item) + (e.key === 'ArrowUp' ? -1 : 1);
    if (list[i]) apply(list[i]!);
  };
  return (
    <>
      {error && <Message error>{error}</Message>}
      <div className={`sc-grid ${busy ? 'busy' : ''}`}>
        {ordered.map((s, i) => {
          const visible = s.sets.filter(
            (x) => !x.retired && matchesPrio(x.priority, prio) && matchesRole(x.exposureRole, role),
          );
          // en «Ejecución» se muestran TODOS los ejercicios con lo que cargó el atleta (nada se completa ni se omite en silencio)
          const shown: SetRow[] = visible;
          const groups = groupByExercise(shown);
          const all = s.sets.filter((x) => !x.retired);
          const done = all.filter((x) => x.actual?.status === 'done').length;
          const state = done === 0 ? 'none' : done >= all.length ? 'all' : 'part';
          return (
            <article
              key={s.sessionKey}
              className={`sc ${s.sessionKey === selectedKey ? 'on' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onEdit(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onEdit(s);
                }
              }}
              title="Tocá para editar la sesión"
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(SES)) {
                  e.preventDefault();
                  setOver(`s:${s.sessionKey}`);
                }
              }}
              onDragLeave={() => setOver((o) => (o === `s:${s.sessionKey}` ? '' : o))}
              onDrop={(e) => dropOn(e, SES, (from) => reorderSessions(from, s.sessionKey))}
              data-over={over === `s:${s.sessionKey}` || undefined}
            >
              <header className="sc-head">
                <button
                  type="button"
                  className="grip"
                  draggable={!busy}
                  aria-label={`Mover la sesión ${i + 1} a otro día (arrastrar, o Alt+↑/↓)`}
                  title="Arrastrá para cambiar el día de la sesión"
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(SES, s.sessionKey);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onKeyDown={(e) =>
                    keyMove(
                      e,
                      ordered.map((x) => x.sessionKey),
                      s.sessionKey,
                      (t) => reorderSessions(s.sessionKey, t),
                    )
                  }
                >
                  ⠿
                </button>
                <strong>Sesión {i + 1}</strong>
                <span>
                  {weekday(s.date)} {dateLabel(s.date)}
                </span>
                {s.endFatigue != null && (
                  <small className="sc-done" title="El atleta cerró este entreno">
                    ✓ fatiga {s.endFatigue}/10
                  </small>
                )}
              </header>
              <ul className="sc-body">
                {groups.map((g) => (
                  <li
                    key={g.name}
                    className="sc-row"
                    data-over={over === `e:${s.sessionKey}:${g.name}` || undefined}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(EX)) {
                        e.preventDefault();
                        e.stopPropagation();
                        setOver(`e:${s.sessionKey}:${g.name}`);
                      }
                    }}
                    onDragLeave={() => setOver((o) => (o === `e:${s.sessionKey}:${g.name}` ? '' : o))}
                    onDrop={(e) =>
                      dropOn(e, EX, (from) => {
                        const [sk, ...rest] = from.split('\u0000');
                        if (sk === s.sessionKey) reorderExercises(s, rest.join('\u0000'), g.name);
                      })
                    }
                  >
                    <button
                      type="button"
                      className="grip"
                      draggable={!busy}
                      aria-label={`Mover ${g.name} dentro de la sesión (arrastrar, o Alt+↑/↓)`}
                      title="Arrastrá para cambiar el orden"
                      onClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        e.dataTransfer.setData(EX, `${s.sessionKey}\u0000${g.name}`);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onKeyDown={(e) =>
                        keyMove(
                          e,
                          groupByExercise(s.sets).map((x) => x.name),
                          g.name,
                          (t) => reorderExercises(s, g.name, t),
                        )
                      }
                    >
                      ⠿
                    </button>
                    <span className="sc-ex">
                      <PriorityBadge priority={g.priority} />
                      <RoleBadge role={g.role} />
                      {g.name}
                    </span>
                    {mode === 'plan' ? (
                      <span className="sc-proto">
                        {protocolText(g)
                          .split(' + ')
                          .map((b, k) => (
                            <span key={k}>{b}</span>
                          ))}
                      </span>
                    ) : (
                      <span className="sc-proto">{executedSummary(g.sets)}</span>
                    )}
                    {mode !== 'plan' && (
                      <ul className="sc-actual" aria-label={`Series de ${g.name}`}>
                        <li className="sc-planned">Previsto: {protocolText(g)}</li>
                        {g.sets.map((x) => (
                          <li key={x.plannedSetId} className={`sc-aset ${x.actual?.status ?? 'none'}`}>
                            <span className="sc-no">{x.isWarmup ? 'A' : x.setNo}</span>
                            {x.actual?.status === 'done' ? (
                              <>
                                <span className="sc-data">
                                  {x.actual.reps != null ? x.actual.reps : '—'} ×{' '}
                                  {x.actual.kg != null ? `${number(x.actual.kg)} kg` : '— kg'}
                                </span>
                                <RpeChip
                                  value={x.actual.rpe}
                                  label={null}
                                  title="RPE real cargado por el atleta"
                                />
                                {x.actual.pain != null && (
                                  <span className="sc-pain">dolor {x.actual.pain}/10</span>
                                )}
                                <span className="sc-vs">
                                  prev. {x.planned.reps}
                                  {x.planned.kg != null ? ` × ${number(x.planned.kg)} kg` : ''}
                                  {x.planned.targetRpe != null ? ` @${number(x.planned.targetRpe)}` : ''}
                                </span>
                              </>
                            ) : (
                              <span className="sc-none">
                                {x.actual?.status === 'skipped' ? 'omitida' : 'sin registrar'}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
                {!groups.length && (
                  <li className="sc-empty">
                    {mode === 'plan' ? 'Sin ejercicios para este filtro' : 'Todavía sin series ejecutadas'}
                  </li>
                )}
              </ul>
              <footer className="sc-foot">
                <span className={`sc-state ${state}`}>
                  {state === 'all'
                    ? 'ejecutada'
                    : state === 'part'
                      ? `${done}/${all.length} series`
                      : 'sin ejecutar'}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRecord(s);
                  }}
                >
                  Registrar
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </>
  );
}
