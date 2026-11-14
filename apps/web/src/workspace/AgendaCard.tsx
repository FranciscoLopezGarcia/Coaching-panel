import type { AgendaData, AgendaSessionData } from '@coaching/contracts';
import { request } from '../api/client';
import { Async } from '../components/Async';
import { useLoad } from '../hooks';
import { dateLabel } from './ui';

export const STATUS_LABEL: Record<AgendaSessionData['status'], string> = {
  hecha: 'Hecha',
  parcial: 'Parcial',
  sin_registro: 'Sin registro',
  pendiente: 'Pendiente',
};
const WEEKDAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const dayName = (iso: string) => WEEKDAY[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/** Hoy y semana del atleta: qué se programó, qué se registró y qué todavía no. Solo lectura. */
export function AgendaCard({
  id,
  onOpen,
}: {
  id: string;
  onOpen?: (sessionKey: string, date: string) => void;
}) {
  const a = useLoad(() => request<AgendaData>(`/api/athletes/${id}/agenda`), [id]);
  return (
    <section className="card agenda-card" aria-label="Hoy y semana">
      <h2>Hoy y esta semana</h2>
      <Async state={a}>{(d) => <AgendaBody d={d} onOpen={onOpen} />}</Async>
    </section>
  );
}

function AgendaBody({ d, onOpen }: { d: AgendaData; onOpen?: (sessionKey: string, date: string) => void }) {
  const hoy = d.sessions.filter((s) => s.date === d.today);
  return (
    <>
      <p className="small muted">
        Semana {dateLabel(d.week.from)} → {dateLabel(d.week.to)} · hoy {dayName(d.today)} {dateLabel(d.today)}
      </p>
      <div className="agenda-flags">
        <span className={`agenda-flag ${d.checkInToday ? 'ok' : ''}`}>
          Check-in de hoy:{' '}
          {d.checkInToday ? 'cargado' : d.lastCheckIn ? `último ${dateLabel(d.lastCheckIn)}` : 'sin datos'}
        </span>
        <span className="agenda-flag">
          Series con molestia (7 d):{' '}
          {d.painSets7d.count ? `${d.painSets7d.count} · máx ${d.painSets7d.max}/10` : 'ninguna registrada'}
        </span>
        {d.nextCompetition && (
          <span className="agenda-flag">
            Próxima competencia: {d.nextCompetition.name} · {d.nextCompetition.daysLeft} d
          </span>
        )}
      </div>
      <h3>Hoy</h3>
      {hoy.length ? (
        <ul className="agenda-list">
          {hoy.map((s) => (
            <SessionLine key={s.sessionKey} s={s} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="muted">No hay sesiones programadas hoy.</p>
      )}
      <h3>Semana</h3>
      {d.sessions.length ? (
        <ul className="agenda-list">
          {d.sessions.map((s) => (
            <SessionLine key={s.sessionKey} s={s} onOpen={onOpen} showDay />
          ))}
        </ul>
      ) : (
        <p className="muted">No hay sesiones programadas esta semana.</p>
      )}
    </>
  );
}

function SessionLine({
  s,
  onOpen,
  showDay,
}: {
  s: AgendaSessionData;
  onOpen?: (sessionKey: string, date: string) => void;
  showDay?: boolean;
}) {
  return (
    <li className="agenda-item">
      <span className={`agenda-status s-${s.status}`}>{STATUS_LABEL[s.status]}</span>
      {showDay && (
        <span className="agenda-day">
          {dayName(s.date)} {dateLabel(s.date)}
        </span>
      )}
      <span className="agenda-ex">
        {s.exercises.slice(0, 4).join(' · ')}
        {s.exercises.length > 4 ? ' …' : ''}
      </span>
      <span className="muted small">
        {s.setsDone}/{s.setsPlanned} series{s.setsSkipped ? ` · ${s.setsSkipped} omitidas` : ''}
      </span>
      {onOpen && (
        <button type="button" onClick={() => onOpen(s.sessionKey, s.date)}>
          Abrir
        </button>
      )}
    </li>
  );
}

/** Tablero «hoy» de todo el plantel (Inicio): una fila por atleta con lo de hoy y el avance de la semana. */
export function TodayBoard({ link }: { link: (athleteId: string) => string }) {
  const t = useLoad(
    () => request<(AgendaData & { athleteId: string; athleteName: string })[]>('/api/today'),
    [],
  );
  return (
    <Async state={t}>
      {(rows) =>
        rows.length ? (
          <ul className="agenda-list">
            {rows.map((r) => {
              const hoy = r.sessions.filter((s) => s.date === r.today);
              const done = r.sessions.filter((s) => s.status === 'hecha').length;
              return (
                <li key={r.athleteId} className="agenda-item">
                  <a href={link(r.athleteId)}>{r.athleteName}</a>
                  <span className="agenda-ex">
                    {hoy.length
                      ? hoy
                          .map(
                            (s) => `${s.exercises[0] ?? 'Sesión'} (${STATUS_LABEL[s.status].toLowerCase()})`,
                          )
                          .join(' · ')
                      : 'Sin sesión hoy'}
                  </span>
                  <span className="muted small">
                    semana {done}/{r.sessions.length} hechas · check-in {r.checkInToday ? 'sí' : 'no'}
                    {r.painSets7d.count ? ` · molestias ${r.painSets7d.count}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Sin atletas.</p>
        )
      }
    </Async>
  );
}
