import type { SessionRow } from '@coaching/contracts';
import { dateLabel } from './ui';
import { groupByExercise, protocolText, type SetRow } from './sessionText';
import { matchesPrio, PriorityBadge, usePrio } from './PriorityFilter';

const WD = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const weekday = (d: string) => WD[new Date(d + 'T12:00:00Z').getUTCDay()];

/**
 * Tarjetas chicas para ver una semana de un vistazo: «Sesión N · fecha» y debajo, una línea por ejercicio con su protocolo.
 * Un clic en la tarjeta abre la edición; «Registrar» lleva a cargar la ejecución. Nada más.
 */
export function SessionCards({
  sessions,
  mode,
  selectedKey,
  onEdit,
  onRecord,
}: {
  sessions: SessionRow[];
  mode: string;
  selectedKey?: string;
  onEdit: (s: SessionRow) => void;
  onRecord: (s: SessionRow) => void;
}) {
  const [prio] = usePrio();
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.dayNo - b.dayNo);
  return (
    <div className="sc-grid">
      {ordered.map((s, i) => {
        const visible = s.sets.filter((x) => !x.retired && matchesPrio(x.priority, prio));
        const shown: SetRow[] =
          mode === 'plan'
            ? visible
            : visible
                .filter((x) => x.actual?.status === 'done')
                .map((x) => ({
                  ...x,
                  planned: {
                    reps: x.actual?.reps ?? 0,
                    kg: x.actual?.kg ?? null,
                    targetRpe: x.actual?.rpe ?? null,
                  },
                }));
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
          >
            <header className="sc-head">
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
                <li key={g.name} className="sc-row">
                  <span className="sc-ex">
                    <PriorityBadge priority={g.priority} />
                    {g.name}
                  </span>
                  <span className="sc-proto">
                    {protocolText(g)
                      .split(' + ')
                      .map((b, k) => (
                        <span key={k}>{b}</span>
                      ))}
                  </span>
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
                Registrar →
              </button>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
