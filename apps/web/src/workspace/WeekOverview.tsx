import type { SessionRow } from '@coaching/contracts';
import { dateLabel } from './ui';
export function WeekOverview({
  sessions,
  week,
  onSelect,
}: {
  sessions: SessionRow[];
  week: number;
  onSelect: (v: Record<string, string | null>) => void;
}) {
  const done = sessions.filter(
    (s) => s.sets.length > 0 && s.sets.every((x) => x.actual?.status === 'done'),
  ).length;
  return (
    <section className="week-overview">
      <div className="row between">
        <div>
          <div className="eyebrow">TU PLAN EN MARCHA</div>
          <h2>
            Semana {week || 'actual'}{' '}
            <span className="chip">
              {done} / {sessions.length} sesiones realizadas
            </span>
          </h2>
        </div>
        <button onClick={() => onSelect({ tab: 'plan', action: 'next' })}>Programar próxima semana →</button>
      </div>
      <div className="week-session-list">
        {sessions.map((s) => (
          <button key={s.sessionKey} onClick={() => onSelect({ tab: 'registro', session: s.sessionKey })}>
            <time>{dateLabel(s.date)}</time>
            <strong>{s.exerciseName}</strong>
            <span>{s.sets.every((x) => x.actual?.status === 'done') ? '✓ Realizada' : 'Registrar →'}</span>
          </button>
        ))}
        {!sessions.length && (
          <p className="muted">
            Sin sesiones en esta selección.{' '}
            <button onClick={() => onSelect({ tab: 'plan' })}>Abrir programación</button>
          </p>
        )}
      </div>
    </section>
  );
}
