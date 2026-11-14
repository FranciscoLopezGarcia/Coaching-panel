import { repsMaxOf, validateRepsRange } from './prescription';
import { useState } from 'react';
import type { ProgramOpFullInput, SessionRow } from '@coaching/contracts';
import { DataSheet } from './DataSheet';
import { validateCell, type SheetColumn, type CellChange } from './sheetModel';
import { workspaceApi as w, type ProgramResult } from './api';
import { Message, usePending, Detail } from './ui';
import { matchesPrio, matchesRole, usePrio, useRole } from './PriorityFilter';

type Change = Extract<ProgramOpFullInput['op'], { type: 'change_protocol' }>['change'];
type Drafts = Record<string, Record<string, string>>;
const modes = [
  { value: 'kg', label: 'Kg fijos' },
  { value: 'pct', label: '% referencia' },
  { value: 'rpe', label: 'RPE' },
  { value: 'rpe_cap', label: 'RPE con tope' },
];
const columns: SheetColumn[] = [
  { key: 'session', label: 'Sesión', readOnly: true },
  { key: 'exerciseName', label: 'Ejercicio', required: true },
  {
    key: 'exposureRole',
    label: 'Rol',
    type: 'select',
    options: [
      { value: '', label: 'Sin rol' },
      { value: 'primaria', label: 'Básico' },
      { value: 'secundaria', label: 'Variante' },
      { value: 'accesorio', label: 'Accesorio' },
    ],
  },
  { key: 'priority', label: 'Prioridad', type: 'number', min: 1, max: 5, step: 1 },
  {
    key: 'segment',
    label: 'Segmento',
    type: 'select',
    options: [
      { value: 'work', label: 'Trabajo' },
      { value: 'top', label: 'Top set' },
      { value: 'backoff', label: 'Backoff' },
    ],
  },
  { key: 'reps', label: 'Reps', type: 'number', min: 1, step: 1, required: true },
  { key: 'repsMax', label: 'Reps máx', type: 'number', min: 1, step: 1 },
  { key: 'plannedKg', label: 'Kg', type: 'number', min: 0.01 },
  { key: 'targetRpe', label: 'RPE', type: 'number', min: 1, max: 10 },
  { key: 'loadMode', label: 'Modo', type: 'select', options: modes },
  { key: 'pct', label: '%', type: 'number', min: 0.01, max: 150 },
  { key: 'capKg', label: 'Tope kg', type: 'number', min: 0.01 },
  { key: 'tempo', label: 'Tempo' },
  { key: 'pauseSec', label: 'Pausa s', type: 'number', min: 0, step: 1 },
  { key: 'instructions', label: 'Instrucciones / descanso' },
  { key: 'variantKey', label: 'Variante', required: true },
];
const protocolKeys = new Set([
  'segment',
  'loadMode',
  'pct',
  'capKg',
  'tempo',
  'pauseSec',
  'instructions',
  'repsMax',
]);
const numeric = new Set([
  'priority',
  'reps',
  'plannedKg',
  'targetRpe',
  'pct',
  'capKg',
  'pauseSec',
  'repsMax',
]);
export function ProgrammingSheet({
  id,
  sessions,
  scope,
  onChanged,
}: {
  id: string;
  sessions: SessionRow[];
  scope: string;
  onChanged: (feedback?: string) => void;
}) {
  const key = `base:program-sheet:${id}:${scope}`;
  const [drafts, setDrafts] = useState<Drafts>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}');
    } catch {
      return {};
    }
  });
  const [review, setReview] = useState<{ input: ProgramOpFullInput; result: ProgramResult }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const baseRows = [...sessions]
    .sort((a, b) => a.date.localeCompare(b.date) || a.dayNo - b.dayNo)
    .flatMap((s) =>
      s.sets
        .filter((x) => !x.retired)
        .map((x) => ({
          id: x.plannedSetId,
          session: `${s.date} · ${s.exerciseName} · ${x.isWarmup ? 'A' : x.setNo}`,
          priority: x.priority == null ? '' : String(x.priority),
          prioN: x.priority == null ? '' : String(x.priority),
          exposureRole: x.exposureRole ?? '',
          exerciseName: x.exerciseName,
          segment: x.protocol?.segment ?? 'work',
          reps: String(x.planned.reps),
          repsMax: repsMaxOf(x.protocol) == null ? '' : String(repsMaxOf(x.protocol)),
          plannedKg: x.planned.kg == null ? '' : String(x.planned.kg),
          targetRpe: x.planned.targetRpe == null ? '' : String(x.planned.targetRpe),
          loadMode: x.protocol?.loadMode ?? 'kg',
          pct: x.protocol?.pct == null ? '' : String(x.protocol.pct),
          capKg: x.protocol?.capKg == null ? '' : String(x.protocol.capKg),
          tempo: x.protocol?.tempo ?? '',
          pauseSec: x.protocol?.pauseSec == null ? '' : String(x.protocol.pauseSec),
          instructions: x.protocol?.instructions ?? '',
          variantKey: x.variantKey,
        })),
    );
  const [prio] = usePrio();
  const [role] = useRole();
  const rows = baseRows.map((r) => ({ ...r, ...drafts[r.id] }));
  // El filtro solo cambia qué filas se ven; las ediciones siguen apuntando a la fila real de la planilla.
  const visible = rows
    .map((r, i) => ({ r, i }))
    .filter(
      (x) =>
        matchesPrio(baseRows[x.i]!.prioN === '' ? null : Number(baseRows[x.i]!.prioN), prio) &&
        matchesRole(baseRows[x.i]!.exposureRole || null, role),
    );
  const changed = rows.filter((r, i) =>
    columns.some((c) => r[c.key as keyof typeof r] !== baseRows[i]![c.key as keyof typeof r]),
  );
  usePending(Object.keys(drafts).length > 0);
  const persist = (next: Drafts) => {
    setDrafts(next);
    try {
      if (Object.keys(next).length) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
    } catch {
      setError('El borrador sigue en pantalla, pero no pudo conservarse en este navegador.');
    }
  };
  const edit = (changes: CellChange[]) => {
    const next = structuredClone(drafts);
    for (const c of changes) {
      const original = baseRows[c.row]!;
      next[original.id] ??= {};
      if (c.value === original[c.key as keyof typeof original]) delete next[original.id]![c.key];
      else next[original.id]![c.key] = c.value;
      if (!Object.keys(next[original.id]!).length) delete next[original.id];
    }
    persist(next);
    setReview(null);
    setMessage('');
  };
  const preview = async () => {
    setBusy(true);
    setError('');
    setReview(null);
    try {
      const groups = new Map<string, { change: Change; ids: string[] }>();
      for (const row of changed) {
        const issue = validateRepsRange(row.reps, row.repsMax);
        if (issue) throw new Error(`${row.session}: ${issue}`);
        const original = baseRows.find((r) => r.id === row.id)!;
        const change: Change = {};
        const protocol: NonNullable<Change['protocol']> = {};
        for (const column of columns.filter((c) => !c.readOnly)) {
          const v = row[column.key as keyof typeof row];
          const issue = validateCell(v, column);
          if (issue) throw new Error(`${row.session}: ${issue}`);
          if (v === original[column.key as keyof typeof original]) continue;
          const value = numeric.has(column.key) ? (v ? Number(v.replace(',', '.')) : null) : v || null;
          if (protocolKeys.has(column.key)) Object.assign(protocol, { [column.key]: value });
          else Object.assign(change, { [column.key]: value });
        }
        if (Object.keys(protocol).length) change.protocol = protocol;
        const signature = JSON.stringify(change);
        const group = groups.get(signature) ?? { change, ids: [] };
        group.ids.push(row.id);
        groups.set(signature, group);
      }
      const results: NonNullable<typeof review> = [];
      for (const group of groups.values()) {
        const input: ProgramOpFullInput = {
          mode: 'preview',
          label: 'Edición de planilla BASE',
          op: { type: 'change_protocol', selection: { setIds: group.ids }, change: group.change },
        };
        const result = await w.program(id, input);
        if (results.length && result.baseVersionId !== results[0]!.result.baseVersionId)
          throw new Error('La programación cambió mientras revisabas. Volvé a previsualizar.');
        results.push({ input: { ...input, baseVersionId: result.baseVersionId }, result });
      }
      setReview(results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!review?.length || busy) return;
    setBusy(true);
    setError('');
    let completed = 0;
    const next = { ...drafts };
    let version = review[0]!.result.baseVersionId;
    try {
      for (const item of review) {
        const res = await w.program(id, { ...item.input, mode: 'apply', baseVersionId: version });
        const ids = item.input.op.type === 'change_protocol' ? (item.input.op.selection.setIds ?? []) : [];
        ids.forEach((k) => delete next[k]);
        persist({ ...next });
        completed += ids.length;
        const saved = res.saved as
          (NonNullable<ProgramResult['saved']> & { version?: { id: string } | null }) | null;
        if (saved?.changed && !saved.version?.id)
          throw new Error('Se guardó el cambio, pero faltó su versión. Recargá antes de continuar.');
        version = saved?.version?.id ?? version;
      }
      setMessage(`${completed} series publicadas. La evaluación debe actualizarse.`);
      setReview(null);
      onChanged(`${completed} series publicadas. La evaluación debe actualizarse.`);
    } catch (e) {
      setError(
        `${completed} series publicadas; las restantes conservan su borrador. ${(e as Error).message}`,
      );
      setReview(null);
      if (completed)
        onChanged(
          `${completed} series publicadas; las restantes conservan su borrador. ${(e as Error).message}`,
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="programming-sheet">
      <div className="row between">
        <div>
          <h3>Programar en planilla</h3>
          <p className="small muted">Una fila por serie. Conserva aproximaciones, top sets y backoffs.</p>
        </div>
        <span role="status" className="chip">
          {changed.length ? `${changed.length} series con cambios pendientes` : 'Sin cambios pendientes'}
        </span>
      </div>
      {error && (
        <>
          <Message error>{error}</Message>
          <button
            disabled={busy}
            onClick={() =>
              onChanged('Plan recargado; el borrador se conservó. Revisá los cambios antes de publicar.')
            }
          >
            Recargar plan y conservar borrador
          </button>
        </>
      )}
      {message && <Message>{message}</Message>}
      <DataSheet
        label="Planilla de programación"
        columns={columns}
        rows={visible.map((x) => x.r)}
        disabled={busy}
        onChange={(changes) => edit(changes.map((c) => ({ ...c, row: visible[c.row]!.i })))}
      />
      {review && (
        <div className="sheet-review">
          <h4>Revisar antes de publicar · {changed.length} series</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Origen / destino</th>
                  <th>Campo</th>
                  <th>Antes</th>
                  <th>Después</th>
                </tr>
              </thead>
              <tbody>
                {changed.flatMap((r) => {
                  const original = baseRows.find((x) => x.id === r.id)!;
                  return columns
                    .filter((c) => r[c.key as keyof typeof r] !== original[c.key as keyof typeof original])
                    .map((c) => (
                      <tr key={r.id + c.key}>
                        <td>{r.session}</td>
                        <td>{c.label}</td>
                        <td>{original[c.key as keyof typeof original] || '—'}</td>
                        <td>{r[c.key as keyof typeof r] || '—'}</td>
                      </tr>
                    ));
                })}
              </tbody>
            </table>
          </div>
          {review.flatMap((r, i) =>
            r.result.warnings.map((warning, j) => <Message key={`${i}-${j}`}>{warning}</Message>),
          )}
          <p className="small muted">
            Se publican {review.length} operaciones trazables en orden. Si una falla, se detienen las
            siguientes y se conservan sus borradores. Los resultados registrados no se copian ni se editan.
          </p>
          <details>
            <summary>Vista previa oficial por operación</summary>
            {review.map((r, i) => (
              <Detail key={i} value={r.result.preview} />
            ))}
          </details>
        </div>
      )}
      <div className="sticky-actions">
        <span>{changed.length ? 'Borrador en este navegador' : 'Programación guardada'}</span>
        <button disabled={busy || !changed.length} onClick={() => void preview()}>
          {busy ? 'Procesando…' : 'Revisar cambios'}
        </button>
        {!!review?.length && (
          <button className="primary" disabled={busy} onClick={() => void apply()}>
            Publicar cambios de planilla
          </button>
        )}
      </div>
    </section>
  );
}
