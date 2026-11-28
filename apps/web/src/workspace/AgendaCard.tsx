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
  onPlanNext,
}: {
  id: string;
  onOpen?: (sessionKey: string, date: string) => void;
  onPlanNext?: () => void;
}) {
  const a = useLoad(() => request<AgendaData>(`/api/athletes/${id}/agenda`), [id]);
  return (
    <section className="card agenda-card" aria-label="Hoy y semana">
      <div className="row between">
        <h2>Hoy y esta semana</h2>
        {onPlanNext && (
          <button type="button" onClick={onPlanNext}>
            Programar próxima semana
          </button>
        )}
      </div>
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
