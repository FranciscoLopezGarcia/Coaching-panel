import { useState } from 'react';
import { api } from '../api/client';
import type {
  AthleteDetail,
  DecisionRow,
  Intervention,
  InterventionTransitionInput,
} from '@coaching/contracts';
import { workspaceApi as w, send, type Evidence } from './api';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { StatusBadge } from '../components/StatusBadge';
import { HistoryTab } from '../pages/athlete/HistoryTab';
import { Detail, Empty, Modal, Message, today, number } from './ui';
export function EvidenceDialog({ id, row, onClose }: { id: string; row: DecisionRow; onClose: () => void }) {
  const data = useLoad(() => w.evidence(id, row.key), [id, row.key]);
  return (
    <Modal title="Evidencia de la recomendación" onClose={onClose}>
      <StatusBadge status={row.status} />
      <p className="summary">{row.summary}</p>
      <Async state={data}>{(e) => <EvidenceBody data={e} />}</Async>
    </Modal>
  );
}
function EvidenceBody({ data }: { data: Evidence }) {
  const e = data.explanation;
  return (
    <>
      {e ? (
        <>
          <p>{e.whatHappens}</p>
          <h3>Por qué</h3>
          <ul>
            {e.why.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <h3>Propuesta para revisar</h3>
          <ul>
            {e.reviewOrTry.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <details open>
            <summary>Límites y datos faltantes</summary>
            <ul>
              {[...e.limits, ...e.missing].map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </details>
          <Message>
            Próximo chequeo: {e.nextCheck.when}. {e.nextCheck.criterion}
          </Message>
          <p className="small muted">
            {e.ruleId} · {e.ruleVersion} · {e.paramsVersion} · corte {e.context.cutoff} ·{' '}
            {e.context.period ? e.context.period.from + ' → ' + e.context.period.to : 'Sin período definido'}
          </p>
          <details>
            <summary>Evaluación de evidencia y parámetros</summary>
            <Detail
              value={{
                assessment: e.assessment,
                parametros: e.paramsApplied,
                validez: e.validity,
                dependencias: e.dependencies,
              }}
            />
          </details>
        </>
      ) : (
        <Message>Explicación estructurada no disponible para esta evaluación. Re-evaluá al atleta.</Message>
      )}
      <h3>Registros de soporte</h3>
      {data.records.map((r, i) => (
        <details key={i}>
          <summary>
            {r.ref.kind} · {r.ref.date ?? r.ref.id}
          </summary>
          {r.sets ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Ejercicio / serie</th>
                    <th>Previsto</th>
                    <th>Realizado</th>
                  </tr>
                </thead>
                <tbody>
                  {r.sets.map((s) => (
                    <tr key={s.planned.id}>
                      <td>
                        {s.planned.exerciseName} · {s.planned.setNo}
                      </td>
                      <td>
                        {s.planned.reps} × {number(s.planned.plannedKg)} kg @ {number(s.planned.targetRpe)}
                      </td>
                      <td>
                        {number(s.actual?.reps)} × {number(s.actual?.kg)} kg @ {number(s.actual?.rpe)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Detail value={r.checkin ?? r.review ?? r.ref} />
          )}
        </details>
      ))}
      {!data.records.length && <p className="muted">Sin referencias de registros disponibles.</p>}
    </>
  );
}
export function FollowUp({
  id,
  athlete,
  onChanged,
}: {
  id: string;
  athlete: AthleteDetail;
  onChanged: () => void;
}) {
  const [view, setView] = useState('interventions');
  const [evidence, setEvidence] = useState<DecisionRow | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRev] = useState(0);
  const [manual, setManual] = useState(false);
  const [lift, setLift] = useState('SQ');
  const [note, setNote] = useState('');
  const interventions = useLoad(() => w.interventions(id), [id, revision]);
  const refresh = () => {
    setRev((x) => x + 1);
    onChanged();
  };
  return (
    <section>
      <div className="row between">
        <div>
          <h2>Seguimiento del coach</h2>
          <p className="muted small">Hallazgo → propuesta → decisión → aplicación → respuesta observada.</p>
        </div>
        <button onClick={() => setManual(true)}>＋ Intervención manual</button>
      </div>
      <div className="row tabs">
        <button className={view === 'interventions' ? 'on' : ''} onClick={() => setView('interventions')}>
          Decisiones e intervenciones
        </button>
        <button className={view === 'history' ? 'on' : ''} onClick={() => setView('history')}>
          Historial automático
        </button>
      </div>
      {error && <Message error>{error}</Message>}
      {view === 'interventions' ? (
        <>
          <h3>Hallazgos y propuestas vigentes</h3>
          {athlete.decisions
            .filter((d) => d.validity === 'vigente')
            .map((d) => (
              <article className="finding-row" key={d.key}>
                <div>
                  <div className="row">
                    <span className="chip">{d.lift}</span>
                    <StatusBadge status={d.status} />
                    <span className="chip">{d.sufficiency}</span>
                  </div>
                  <p className="summary">{d.summary}</p>
                  {d.proposal && <p className="small">Propuesta: {d.proposal}</p>}
                </div>
                <div className="row">
                  <button onClick={() => setEvidence(d)}>Abrir evidencia</button>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError('');
                      try {
                        await send(id, 'interventions', { proposalKey: d.key });
                        refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Revisar intervención
                  </button>
                </div>
              </article>
            ))}
          <h3>Intervenciones y seguimiento</h3>
          <Message>
            Aceptar registra la decisión. Publicar la programación y registrar su aplicación son acciones
            separadas. El seguimiento describe lo observado; no establece causalidad.
          </Message>
          <Async state={interventions}>
            {(list) =>
              list.length ? (
                list.map((x) => (
                  <InterventionCard
                    key={x.intervention.id + JSON.stringify(x.intervention.history)}
                    id={id}
                    value={x.intervention}
                    followUp={x.followUp}
                    onChanged={refresh}
                  />
                ))
              ) : (
                <Empty title="Sin intervenciones registradas">
                  Abrí un hallazgo o registrá una intervención manual.
                </Empty>
              )
            }
          </Async>
        </>
      ) : (
        <HistoryTab id={id} />
      )}{' '}
      {evidence && <EvidenceDialog id={id} row={evidence} onClose={() => setEvidence(null)} />}
      {manual && (
        <Modal title="Intervención manual" onClose={() => setManual(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              try {
                await send(id, 'interventions', { lift, coachNote: note });
                setManual(false);
                refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Movimiento
              <select value={lift} onChange={(e) => setLift(e.target.value)}>
                <option value="SQ">Sentadilla</option>
                <option value="BP">Banca</option>
                <option value="DL">Peso muerto</option>
              </select>
            </label>
            <label>
              Motivo opcional
              <textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button disabled={busy} className="primary">
              Registrar hallazgo manual
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
const nextStates: Record<Intervention['state'], Intervention['state'][]> = {
  detectada: ['revisada', 'aceptada', 'descartada'],
  revisada: ['aceptada', 'descartada'],
  aceptada: ['aplicada', 'descartada'],
  descartada: ['revisada'],
  aplicada: ['seguimiento', 'cerrada'],
  seguimiento: ['cerrada'],
  cerrada: [],
};
function InterventionCard({
  id,
  value: i,
  followUp,
  onChanged,
}: {
  id: string;
  value: Intervention;
  followUp: unknown;
  onChanged: () => void;
}) {
  const [note, setNote] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today());
  const [event, setEvent] = useState(i.linkedEventId ?? '');
  const [deviates, setDeviates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<Intervention['state'] | ''>('');
  const events = useLoad(() => api.history(id), [id]);
  const transition = async (to: Intervention['state']) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const payload: InterventionTransitionInput = {
        to,
        note: note || undefined,
        ...(to === 'aplicada'
          ? {
              appliedOn: date,
              appliedDescription: description,
              deviatesFromProposal: deviates,
              ...(event ? { linkedEventId: event } : {}),
            }
          : {}),
      };
      await send(id, `interventions/${encodeURIComponent(i.id)}/transition`, payload);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="card intervention">
      <div className="row between">
        <strong>
          {i.lift ?? 'Global'} · {i.origin === 'manual' ? 'Intervención manual' : 'Propuesta del motor'}
        </strong>
        <span className="badge tone-info">{i.state}</span>
      </div>
      <p>{i.appliedDescription ?? i.coachNote ?? 'Sin motivo agregado'}</p>
      <div className="lifecycle">
        <span>Detectada {i.detectedOn ?? '—'}</span>
        <span>Decidida {i.decidedOn ?? '—'}</span>
        <span>Aplicada {i.appliedOn ?? '—'}</span>
        <span>Cerrada {i.closedOn ?? '—'}</span>
      </div>
      <label>
        Nota / motivo (opcional)
        <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        {nextStates[i.state].map((to) => (
          <button
            disabled={busy}
            key={to}
            onClick={() => (to === 'aplicada' ? setTarget(to) : void transition(to))}
          >
            {
              {
                revisada: 'Marcar revisada',
                aceptada: 'Aceptar propuesta',
                descartada: 'Descartar',
                aplicada: 'Registrar aplicación',
                seguimiento: 'Iniciar seguimiento',
                cerrada: 'Cerrar',
                detectada: 'Detectada',
              }[to]
            }
          </button>
        ))}
      </div>
      {target === 'aplicada' && (
        <form
          className="preview"
          onSubmit={(e) => {
            e.preventDefault();
            void transition('aplicada');
          }}
        >
          <h4>Registrar qué se aplicó realmente</h4>
          <label>
            Fecha de aplicación
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            Descripción aplicada
            <textarea
              maxLength={500}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Cambio de plan vinculado (opcional)
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              <option value="">Sin vínculo</option>
              {events.data?.events.map((x) => (
                <option key={x.event.id} value={x.event.id}>
                  {x.event.detectedOn} · {x.event.changes.map((c) => c.summary).join(' / ')}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={deviates} onChange={(e) => setDeviates(e.target.checked)} />
            Lo aplicado difiere de la propuesta
          </label>
          <button disabled={busy} className="primary">
            Confirmar aplicación registrada
          </button>
          <p className="small muted">
            Este registro no publica cambios al plan. Publicá la programación desde el editor cuando
            corresponda.
          </p>
        </form>
      )}
      <details>
        <summary>Historia de estados y respuesta observada</summary>
        <Detail value={i.history} />
        <Detail value={followUp} />
      </details>
      {error && <Message error>{error}</Message>}
    </article>
  );
}
