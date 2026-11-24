import type { DecisionRow } from '@coaching/contracts';
import { workspaceApi as w, type Evidence } from './api';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { StatusBadge } from '../components/StatusBadge';
import { Detail, Message, Modal, number } from './ui';
import { RpeChip } from '../components/RpeChip';

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
                        {s.planned.reps} × {number(s.planned.plannedKg)} kg @{' '}
                        <RpeChip value={s.planned.targetRpe} label={null} />
                      </td>
                      <td>
                        {number(s.actual?.reps)} × {number(s.actual?.kg)} kg @{' '}
                        <RpeChip value={s.actual?.rpe} label={null} />
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
