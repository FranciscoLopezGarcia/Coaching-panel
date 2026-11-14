import { useState } from 'react';
import type { AttemptInput, CompetitionDetail, CompetitionInput, LiftMarksData } from '@coaching/contracts';
import { request } from '../api/client';
import { Async } from '../components/Async';
import { useLoad } from '../hooks';
import { Message, Modal, dateLabel, number, today } from './ui';

type Lift = 'SQ' | 'BP' | 'DL';
const LIFTS: Lift[] = ['SQ', 'BP', 'DL'];
const LIFT_NAME: Record<Lift, string> = { SQ: 'Sentadilla', BP: 'Banca', DL: 'Peso muerto' };
const num = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));

/** Calendario de competencias del atleta, intentos (previsto vs realizado) y marcas de competencia vs entrenamiento. */
export function CompetitionsPanel({ id }: { id: string }) {
  const comps = useLoad(() => request<CompetitionDetail[]>(`/api/athletes/${id}/competitions-detail`), [id]);
  // Las marcas se vuelven a pedir solo cuando cambian los intentos válidos (no en cada recarga de la lista).
  const marksKey = (comps.data ?? []).map((c) => `${c.id}:${JSON.stringify(c.best)}`).join('|');
  const marks = useLoad(() => request<LiftMarksData[]>(`/api/athletes/${id}/marks`), [id, marksKey]);
  const [edit, setEdit] = useState<CompetitionDetail | 'nueva' | null>(null);
  const [att, setAtt] = useState<CompetitionDetail | null>(null);
  const [msg, setMsg] = useState('');
  return (
    <div className="competitions-panel">
      <section className="card">
        <div className="row between">
          <h2>Calendario de competencias</h2>
          <button className="primary" onClick={() => setEdit('nueva')}>
            + Nueva competencia
          </button>
        </div>
        {msg && <Message>{msg}</Message>}
        <Async state={comps}>
          {(list) => {
            const next = list.filter((c) => c.daysLeft >= 0);
            const past = list.filter((c) => c.daysLeft < 0).reverse();
            const row = (c: CompetitionDetail) => (
              <li key={c.id} className="comp-item">
                <div>
                  <strong>{c.name}</strong>{' '}
                  {c.importance && <span className="role-badge role-primaria">Prioridad {c.importance}</span>}
                  <div className="small muted">
                    {dateLabel(c.date)}
                    {c.daysLeft >= 0 ? ` · faltan ${c.daysLeft} d` : ` · hace ${-c.daysLeft} d`}
                    {c.phase ? ` · ${c.phase}` : ''}
                    {c.location ? ` · ${c.location}` : ''}
                    {c.weightClass ? ` · cat. ${c.weightClass}` : ''}
                  </div>
                  {c.attempts.length > 0 && (
                    <div className="small">
                      Válidos:{' '}
                      {LIFTS.map((l) => `${l} ${c.best[l] === undefined ? '—' : number(c.best[l])}`).join(
                        ' · ',
                      )}{' '}
                      · total {c.total === null ? '— (falta algún movimiento)' : `${number(c.total)} kg`}
                    </div>
                  )}
                  {c.notes && <div className="small muted">{c.notes}</div>}
                </div>
                <div className="row">
                  <button onClick={() => setAtt(c)}>Intentos</button>
                  <button onClick={() => setEdit(c)}>Editar</button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`¿Borrar «${c.name}» y sus intentos? No se puede deshacer.`))
                        return;
                      try {
                        await request(`/api/athletes/${id}/competitions/${c.id}`, {
                          method: 'DELETE',
                          body: '{}',
                        });
                        comps.reload();
                      } catch (e) {
                        setMsg((e as Error).message);
                      }
                    }}
                  >
                    Borrar
                  </button>
                </div>
              </li>
            );
            return (
              <>
                <h3>Próximas</h3>
                {next.length ? (
                  <ul className="comp-list">{next.map(row)}</ul>
                ) : (
                  <p className="muted">Sin competencias próximas cargadas.</p>
                )}
                {past.length > 0 && (
                  <>
                    <h3>Pasadas</h3>
                    <ul className="comp-list">{past.map(row)}</ul>
                  </>
                )}
              </>
            );
          }}
        </Async>
      </section>
      <section className="card">
        <h2>Marcas: competencia vs entrenamiento</h2>
        <p className="small muted">
          Lado a lado, sin estimar una a partir de la otra. Entrenamiento = series reales con el ejercicio de
          competencia del atleta; el e1RM usa solo series con RPE real.
        </p>
        <Async state={marks}>
          {(rows) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Movimiento</th>
                    <th>Competencia (válido)</th>
                    <th>Entreno · mayor carga</th>
                    <th>Entreno · mejor single</th>
                    <th>Entreno · mejor e1RM</th>
                    <th>Comp − single</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.lift}>
                      <td>{LIFT_NAME[m.lift]}</td>
                      <td>
                        {m.competition
                          ? `${number(m.competition.kg)} kg · ${dateLabel(m.competition.date)}`
                          : '—'}
                      </td>
                      <td>
                        {m.trainingHeaviest
                          ? `${number(m.trainingHeaviest.kg)} kg × ${m.trainingHeaviest.reps} · ${dateLabel(m.trainingHeaviest.date)}`
                          : '—'}
                      </td>
                      <td>
                        {m.trainingSingle
                          ? `${number(m.trainingSingle.kg)} kg · ${dateLabel(m.trainingSingle.date)}`
                          : '—'}
                      </td>
                      <td>
                        {m.trainingE1rm
                          ? `${number(m.trainingE1rm.kg)} kg · ${dateLabel(m.trainingE1rm.date)}`
                          : '—'}
                      </td>
                      <td>{m.diffKg === null ? '—' : `${m.diffKg > 0 ? '+' : ''}${number(m.diffKg)} kg`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Async>
      </section>
      {edit && (
        <CompetitionDialog
          id={id}
          comp={edit === 'nueva' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            comps.reload();
          }}
        />
      )}
      {att && (
        <AttemptsDialog
          id={id}
          comp={att}
          onClose={() => setAtt(null)}
          onSaved={() => {
            setAtt(null);
            comps.reload();
          }}
        />
      )}
    </div>
  );
}

function CompetitionDialog({
  id,
  comp,
  onClose,
  onSaved,
}: {
  id: string;
  comp: CompetitionDetail | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: comp?.name ?? '',
    date: comp?.date ?? today(),
    phase: comp?.phase ?? '',
    location: comp?.location ?? '',
    weightClass: comp?.weightClass ?? '',
    bodyweightKg:
      comp?.bodyweightKg === null || comp?.bodyweightKg === undefined ? '' : String(comp.bodyweightKg),
    importance: comp?.importance ?? '',
    notes: comp?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={comp ? 'Editar competencia' : 'Nueva competencia'} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const body: CompetitionInput = {
            name: f.name.trim(),
            date: f.date,
            phase: f.phase.trim(),
            location: f.location.trim(),
            weightClass: f.weightClass.trim(),
            bodyweightKg: num(f.bodyweightKg),
            importance: f.importance as CompetitionInput['importance'],
            notes: f.notes.trim(),
          };
          try {
            if (comp)
              await request(`/api/athletes/${id}/competitions/${comp.id}`, {
                method: 'PATCH',
                body: JSON.stringify(body),
              });
            else
              await request(`/api/athletes/${id}/competitions`, {
                method: 'POST',
                body: JSON.stringify(body),
              });
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nombre
          <input required maxLength={80} value={f.name} onChange={set('name')} />
        </label>
        <label>
          Fecha
          <input required type="date" value={f.date} onChange={set('date')} />
        </label>
        <label>
          Prioridad
          <select value={f.importance} onChange={set('importance')}>
            <option value="">Sin declarar</option>
            <option value="A">A · principal</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label>
          Fase
          <input maxLength={60} value={f.phase} onChange={set('phase')} placeholder="ej. pico, tope" />
        </label>
        <label>
          Lugar
          <input maxLength={120} value={f.location} onChange={set('location')} />
        </label>
        <label>
          Categoría de peso
          <input maxLength={20} value={f.weightClass} onChange={set('weightClass')} />
        </label>
        <label>
          Peso en la competencia (kg)
          <input inputMode="decimal" value={f.bodyweightKg} onChange={set('bodyweightKg')} />
        </label>
        <label className="wide">
          Notas
          <textarea rows={2} maxLength={500} value={f.notes} onChange={set('notes')} />
        </label>
        {error && <Message error>{error}</Message>}
        <div className="sticky-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !f.name.trim()}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Cell = { planned: string; actual: string; result: string };
const key = (l: Lift, n: number) => `${l}${n}`;

/** Intentos: lo previsto (apertura planificada) y lo realizado van en columnas separadas; el resultado solo se guarda si hubo intento realizado. */
function AttemptsDialog({
  id,
  comp,
  onClose,
  onSaved,
}: {
  id: string;
  comp: CompetitionDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const init: Record<string, Cell> = {};
  for (const l of LIFTS)
    for (const n of [1, 2, 3]) {
      const a = comp.attempts.find((x) => x.lift === l && x.attemptNo === n);
      init[key(l, n)] = {
        planned: a?.plannedKg == null ? '' : String(a.plannedKg),
        actual: a?.actualKg == null ? '' : String(a.actualKg),
        result: a?.result ?? '',
      };
    }
  const [cells, setCells] = useState(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upd = (k: string, patch: Partial<Cell>) => setCells({ ...cells, [k]: { ...cells[k]!, ...patch } });
  return (
    <Modal title={`Intentos · ${comp.name}`} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const attempts: AttemptInput[] = LIFTS.flatMap((l) =>
            [1, 2, 3].map((n) => {
              const c = cells[key(l, n)]!;
              return {
                lift: l,
                attemptNo: n,
                plannedKg: num(c.planned),
                actualKg: num(c.actual),
                result: (c.result || null) as AttemptInput['result'],
                note: '',
              };
            }),
          );
          try {
            await request(`/api/athletes/${id}/competitions/${comp.id}/attempts`, {
              method: 'PUT',
              body: JSON.stringify({ attempts }),
            });
            onSaved();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="small muted">
          «Previsto» es el plan de intentos; «realizado» y «resultado» se cargan en la competencia. Un intento
          sin carga realizada no guarda resultado.
        </p>
        <div className="table-wrap">
          <table className="attempts-table">
            <thead>
              <tr>
                <th>Movimiento</th>
                <th>Intento</th>
                <th>Previsto (kg)</th>
                <th>Realizado (kg)</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {LIFTS.flatMap((l) =>
                [1, 2, 3].map((n) => {
                  const k = key(l, n);
                  const c = cells[k]!;
                  return (
                    <tr key={k}>
                      <td>{n === 1 ? LIFT_NAME[l] : ''}</td>
                      <td>{n}º</td>
                      <td>
                        <input
                          aria-label={`${LIFT_NAME[l]} ${n} previsto`}
                          inputMode="decimal"
                          value={c.planned}
                          onChange={(e) => upd(k, { planned: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${LIFT_NAME[l]} ${n} realizado`}
                          inputMode="decimal"
                          value={c.actual}
                          onChange={(e) => upd(k, { actual: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`${LIFT_NAME[l]} ${n} resultado`}
                          value={c.result}
                          disabled={!c.actual.trim()}
                          onChange={(e) => upd(k, { result: e.target.value })}
                        >
                          <option value="">—</option>
                          <option value="valido">Válido</option>
                          <option value="nulo">Nulo</option>
                        </select>
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
        {error && <Message error>{error}</Message>}
        <div className="sticky-actions">
          <button type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar intentos'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
