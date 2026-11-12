import { isoWeekday, weekOfDate } from './sessionText';
import { WeekDates } from './WeekDates';
import { SessionCards } from './SessionCards';
import { SessionTextEditor } from './SessionTextEditor';
import { WeekCopyDialog } from './WeekCopyDialog';
import { QuickEntry } from './QuickEntry';
import { MOVEMENT_GROUPS, MOVEMENT_OTHER, movementFields, segmentsToText } from './quickSession';
import { BlockNavigator } from './BlockNavigator';
import { PriorityFilter, usePrio } from './PriorityFilter';
import { validateRepsRange } from './prescription';
import { DataSheet } from './DataSheet';
import { validateCell, type SheetColumn } from './sheetModel';
import { ProgrammingSheet } from './ProgrammingSheet';
import { PlanVersions } from './PlanVersions';
import { useEffect, useState } from 'react';
import type { ImportPlanInput, ProgramOpInput, SessionRow } from '@coaching/contracts';
import { ExposureHistory } from './ExposureHistory';
import type { ExposureDetail } from './api';
import { api } from '../api/client';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { workspaceApi as w, get, send, type ProgramResult, type Meso } from './api';
import { Empty, Message, Modal, number, today, shift, dateLabel, Detail, usePending, readSearch } from './ui';
export type KnownSet = ImportPlanInput['sets'][number];
const cacheKey = (id: string) => `base:planned-identities:${id}`;
export function knownSets(id: string): KnownSet[] {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(id)) ?? '[]') as KnownSet[];
  } catch {
    return [];
  }
}
export function rememberSets(id: string, sets: KnownSet[]) {
  const old = knownSets(id);
  localStorage.setItem(
    cacheKey(id),
    JSON.stringify([...old.filter((x) => !sets.some((s) => s.id === x.id)), ...sets]),
  );
}
export function Programming({
  id,
  macro,
  block,
  week,
  session,
  onSelect,
  onChanged,
}: {
  id: string;
  macro: string;
  block: string;
  week: number;
  session: string;
  onSelect: (v: Record<string, string | null>) => void;
  onChanged: () => void;
}) {
  const [rev, setRev] = useState(0);
  const [create, setCreate] = useState<'macro' | 'meso' | 'session' | null>(null);
  const [textEdit, setTextEdit] = useState<SessionRow | null>(null);
  const [copyWeek, setCopyWeek] = useState(false);
  useEffect(() => {
    if (readSearch().get('action') === 'next' && block && week) {
      setOperation('repeat_week');
      onSelect({ action: null });
    }
  }, [block, week]);
  const [operation, setOperation] = useState<ProgramOpInput['op']['type'] | null>(null);
  const [mode, setMode] = useState('plan');
  const [layout, setLayout] = useState('cards');
  const [msg, setMsg] = useState('');
  const [template, setTemplate] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const data = useLoad(async () => {
    const [macros, mesos, sessions, micros] = await Promise.all([
      w.macros(id),
      w.mesos(id),
      api.sessions(id),
      get<{ blockKey: string; weekNo: number; startDate: string; endDate: string }[]>(id, 'microcycles'),
    ]);
    return { macros, mesos, sessions, micros };
  }, [id, rev]);
  const current = useLoad(() => (macro ? w.macro(id, macro) : Promise.resolve(null)), [id, macro, rev]);
  const detail = useLoad(() => (block ? w.meso(id, block) : Promise.resolve(null)), [id, block, rev]);
  const refresh = () => {
    setRev((v) => v + 1);
    onChanged();
  };
  const sessions = data.data?.sessions ?? [];
  const mesos = data.data?.mesos ?? [];
  const selectedSessions = sessions.filter((s) => s.blockKey === block && (!week || s.weekNo === week));
  const weeks = [
    ...new Set([
      ...sessions.filter((s) => s.blockKey === block).map((s) => s.weekNo),
      ...(data.data?.micros.filter((s) => s.blockKey === block).map((s) => s.weekNo) ?? []),
    ]),
  ].sort((a, b) => a - b);
  return (
    <div>
      <div className="section-heading row between">
        <div>
          <h2>Programación</h2>
          <p className="muted small">Distribuí una vez. Progresá sobre los protocolos.</p>
        </div>
        <div className="row">
          <button onClick={() => setCreate('macro')}>＋ Macro</button>
          <button onClick={() => setCreate('meso')}>＋ Meso</button>
          <button className="primary" onClick={() => setCreate('session')}>
            ＋ Sesión
          </button>
        </div>
      </div>
      <div className="row breadcrumbs">
        <button onClick={() => onSelect({ macro: null, block: null, week: null, session: null })}>
          Macros
        </button>
        {macro && (
          <>
            <span>/</span>
            <button onClick={() => onSelect({ block: null, week: null, session: null })}>
              {data.data?.macros.find((x) => x.id === macro)?.name ?? 'Macro'}
            </button>
          </>
        )}
        {block && (
          <>
            <span>/</span>
            <button onClick={() => onSelect({ week: null, session: null })}>
              {mesos.find((x) => x.blockKey === block)?.name ?? block}
            </button>
          </>
        )}
        {!!week && (
          <>
            <span>/</span>
            <button onClick={() => onSelect({ session: null })}>Semana {week}</button>
          </>
        )}
      </div>
      {msg && <Message>{msg}</Message>}
      <Async state={data}>
        {(d) => (
          <>
            {!!d.sessions.length && (
              <BlockNavigator
                id={id}
                onDeleted={() => {
                  onSelect({ block: null, week: null, session: null });
                  refresh();
                }}
                sessions={d.sessions}
                mesos={d.mesos}
                block={block}
                week={week}
                onSelect={onSelect}
              />
            )}
            {!block && !macro && (
              <>
                {!d.macros.length && (
                  <Empty title="Todavía no hay macros">
                    Creá un macro para organizar el ciclo. Los bloques anteriores siguen accesibles debajo.
                  </Empty>
                )}
                <div className="macro-list">
                  {d.macros.map((m) => (
                    <button
                      className="macro-card"
                      key={m.id}
                      onClick={() => onSelect({ macro: m.id, block: null, week: null })}
                    >
                      <span className={`badge tone-${m.status === 'activo' ? 'ok' : 'muted'}`}>
                        {m.status === 'cerrado' ? 'Finalizado' : m.status}
                      </span>
                      <h3>{m.name}</h3>
                      <p>{m.objective ?? 'Sin objetivo definido'}</p>
                      <div className="small muted">
                        {dateLabel(m.startDate)} → {m.endDate ? dateLabel(m.endDate) : 'Abierto'}{' '}
                        <span>↗</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {!block && (
              <div className="meso-list">
                {mesos
                  .filter((m) => !macro || m.macroId === macro)
                  .map((m) => (
                    <button
                      className="meso-row"
                      key={m.blockKey}
                      onClick={() => onSelect({ macro: m.macroId, block: m.blockKey, week: null })}
                    >
                      <span className="monogram">M</span>
                      <div>
                        <strong>{m.name}</strong>
                        <p>{m.objective ?? 'Objetivo pendiente'}</p>
                      </div>
                      <span className="muted small">
                        {m.startDate ?? 'Fechas derivadas'} → {m.endDate ?? 'Abierto'}
                      </span>
                      <span>→</span>
                    </button>
                  ))}
                {macro && !mesos.some((m) => m.macroId === macro) && (
                  <Empty title="Este macro todavía no tiene mesociclos">
                    Creá un meso y asignalo a este macro.
                  </Empty>
                )}
                {!macro &&
                  [...new Set(sessions.map((s) => s.blockKey))]
                    .filter((k) => !mesos.some((m) => m.blockKey === k))
                    .map((k) => (
                      <button className="meso-row" key={k} onClick={() => onSelect({ block: k, week: null })}>
                        <strong>{k}</strong>
                        <span className="muted">Bloque previo sin metadatos de mesociclo</span>
                        <span>→</span>
                      </button>
                    ))}
              </div>
            )}
            {macro && !block && current.data && (
              <Message>
                {current.data.durationWeeks === null
                  ? 'Duración abierta'
                  : `${number(current.data.durationWeeks)} semanas`}{' '}
                · {current.data.objective ?? 'Sin objetivo'} · Respuesta detallada disponible dentro de cada
                meso.
              </Message>
            )}
            {block && (
              <>
                <div className="row between toolbar">
                  <div className="row">
                    <button className={mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>
                      Planificación
                    </button>
                    <button className={mode === 'actual' ? 'on' : ''} onClick={() => setMode('actual')}>
                      Ejecución y respuesta
                    </button>
                  </div>
                  <div className="row">
                    <button
                      className="primary"
                      onClick={() => setCopyWeek(true)}
                      disabled={!week || !selectedSessions.length}
                      title={
                        week
                          ? 'Copiar el microciclo completo a otras semanas y retocarlo'
                          : 'Elegí una semana (S1, S2…)'
                      }
                    >
                      ⧉ Duplicar semana…
                    </button>
                    <button onClick={() => setOperation('repeat_week')} disabled={!weeks.length}>
                      Crear siguiente semana
                    </button>
                    <button onClick={() => setOperation('repeat_structure')} disabled={!weeks.length}>
                      Repetir estructura
                    </button>
                    <button onClick={() => setTemplate(true)} disabled={!weeks.length}>
                      Guardar plantilla
                    </button>
                    <button onClick={() => setOperation('apply_template')}>Aplicar plantilla</button>
                    <button
                      onClick={() => setOperation('change_protocol')}
                      disabled={!selectedSessions.length}
                    >
                      Modificar protocolos
                    </button>
                  </div>
                </div>
                <div className="row week-selector">
                  <button
                    className={!week ? 'on' : ''}
                    onClick={() => onSelect({ week: null, session: null })}
                  >
                    Todas las semanas
                  </button>
                  {weeks.map((n) => (
                    <button
                      key={n}
                      className={week === n ? 'on' : ''}
                      onClick={() => onSelect({ week: String(n), session: null })}
                    >
                      S{n}
                    </button>
                  ))}
                </div>
                {!week ? (
                  <div className="wk-list">
                    {weeks.map((n) => {
                      const ss = sessions.filter((s) => s.blockKey === block && s.weekNo === n);
                      const summary = detail.data?.microcycles.find((m) => m.weekNo === n);
                      const dates = d.micros.find((x) => x.blockKey === block && x.weekNo === n);
                      return (
                        <section className="wk" key={n}>
                          <header className="wk-head">
                            <h3>Semana {n}</h3>
                            <span className="small muted">
                              {dateLabel(summary?.from ?? dates?.startDate ?? ss.at(-1)?.date)} →{' '}
                              {dateLabel(summary?.to ?? dates?.endDate ?? ss[0]?.date)}
                              {mode === 'plan' && summary?.planned?.nl != null
                                ? ` · ${number(summary.planned.nl, 0)} NL · ${number(summary.planned.sets, 0)} series`
                                : ''}
                              {mode === 'actual' && summary?.compliance != null
                                ? ` · cumplimiento ${number(summary.compliance * 100)} %`
                                : ''}
                            </span>
                            <WeekDates
                              id={id}
                              all={sessions}
                              micros={d.micros}
                              block={block}
                              week={n}
                              onDone={(m) => {
                                setMsg(m);
                                refresh();
                              }}
                            />
                            <button onClick={() => onSelect({ week: String(n), session: null })}>
                              Abrir semana →
                            </button>
                          </header>
                          {ss.length ? (
                            <SessionCards
                              sessions={ss}
                              mode={mode}
                              selectedKey={session}
                              onEdit={(s) => setTextEdit(s)}
                              onRecord={(s) => onSelect({ tab: 'registro', session: s.sessionKey })}
                            />
                          ) : (
                            <p className="muted small">Sin sesiones programadas.</p>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <div className="row between">
                      <h3>
                        Semana {week} <span className="chip">{selectedSessions.length} sesiones</span>
                      </h3>
                      <WeekDates
                        id={id}
                        all={sessions}
                        micros={d.micros}
                        block={block}
                        week={week}
                        onDone={(m) => {
                          setMsg(m);
                          refresh();
                        }}
                      />
                      <button
                        onClick={() => setOperation('duplicate_session')}
                        disabled={!selectedSessions.length}
                      >
                        Duplicar sesión
                      </button>
                    </div>
                    {mode === 'plan' && (
                      <div className="row sheet-layout-switch">
                        <button className={layout === 'cards' ? 'on' : ''} onClick={() => setLayout('cards')}>
                          Tarjetas
                        </button>
                        <button className={layout === 'sheet' ? 'on' : ''} onClick={() => setLayout('sheet')}>
                          Planilla por series (editar celdas)
                        </button>
                      </div>
                    )}
                    {mode === 'plan' && <PriorityFilterBar />}
                    {mode === 'plan' && layout === 'sheet' ? (
                      <ProgrammingSheet
                        key={`${id}:${block}:${week}`}
                        id={id}
                        sessions={selectedSessions}
                        scope={`${block}:${week}`}
                        onChanged={(feedback) => {
                          if (feedback) setMsg(feedback);
                          refresh();
                        }}
                      />
                    ) : (
                      <>
                        <SessionCards
                          sessions={selectedSessions}
                          mode={mode}
                          selectedKey={session}
                          onEdit={(s) => setTextEdit(s)}
                          onRecord={(s) => onSelect({ tab: 'registro', session: s.sessionKey })}
                        />
                      </>
                    )}
                    {!selectedSessions.length && (
                      <Empty title="Semana sin sesiones">Creá una sesión o aplicá una plantilla.</Empty>
                    )}
                  </>
                )}
                {mode === 'actual' && detail.data && (
                  <>
                    <h3>Respuesta observada por movimiento</h3>
                    {detail.data.perLift.map((l) => (
                      <article className="card" key={l.lift}>
                        <strong>{l.lift}</strong>
                        <p>
                          e1RM: {number(l.eStart)} → {number(l.eEnd)} kg · {l.ttp.note}
                        </p>
                      </article>
                    ))}
                    <p className="muted small">
                      Las diferencias de prescripción se consultan en Seguimiento. La respuesta posterior no
                      establece causalidad.
                    </p>
                  </>
                )}
                {detail.error && (
                  <Message error>
                    {detail.error}. Podés crear sesiones en el meso; su resumen estará disponible cuando
                    contenga series.
                  </Message>
                )}
              </>
            )}
          </>
        )}
      </Async>
      <PlanVersions key={rev} id={id} />
      {textEdit && (
        <SessionTextEditor
          id={id}
          session={textEdit}
          all={sessions}
          onClose={() => setTextEdit(null)}
          onSaved={(m) => {
            setMsg(m);
            refresh();
          }}
        />
      )}
      {copyWeek && week > 0 && (
        <WeekCopyDialog
          id={id}
          sessions={selectedSessions}
          all={sessions}
          block={block}
          week={week}
          onClose={() => setCopyWeek(false)}
          onSaved={(m) => {
            setMsg(m);
            refresh();
          }}
        />
      )}
      {create && (
        <CreateDialog
          id={id}
          kind={create}
          mesos={mesos}
          macros={data.data?.macros ?? []}
          macro={macro}
          block={block}
          week={week || 1}
          all={sessions}
          onClose={() => setCreate(null)}
          onSaved={(selection) => {
            refresh();
            if (selection) onSelect({ tab: 'plan', ...selection });
          }}
        />
      )}
      {operation && (
        <OperationDialog
          id={id}
          type={operation}
          sessions={selectedSessions}
          block={block}
          week={week || weeks.at(-1) || 1}
          session={session || selectedSessions[0]?.sessionKey || ''}
          onClose={() => setOperation(null)}
          onSaved={refresh}
        />
      )}
      {template && (
        <Modal title="Guardar plantilla de semana" onClose={() => setTemplate(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              try {
                await send(id, 'templates', { name, blockKey: block, weekNo: week || weeks.at(-1) });
                setMsg('Plantilla guardada. Solo programación, sin resultados.');
                setTemplate(false);
              } catch (e) {
                setMsg((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Origen: {block} · semana {week || weeks.at(-1)}. Se conserva la distribución y los protocolos.
            </p>
            <label>
              Nombre
              <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <button className="primary" disabled={busy}>
              Guardar plantilla
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
interface Segment {
  exerciseName: string;
  variant: string;
  /** SQ/BP/DL, 'acc:<grupo muscular>' o '' (sin elegir: no deja guardar). */
  lift: string;
  count: string;
  reps: string;
  repsMax: string;
  kg: string;
  rpe: string;
  pct: string;
  ref: string;
  cap: string;
  mode: 'kg' | 'pct' | 'rpe' | 'rpe_cap';
  segment: 'work' | 'top' | 'backoff';
  warmup: boolean;
  tempo: string;
  pause: string;
  rest: string;
  note: string;
  priority: string;
  view?: string;
  prog?: string;
}
const newSegment = (): Segment => ({
  exerciseName: '',
  variant: '',
  lift: '',
  count: '3',
  reps: '5',
  repsMax: '',
  kg: '',
  rpe: '',
  pct: '',
  ref: '',
  cap: '',
  mode: 'kg',
  segment: 'work',
  warmup: false,
  tempo: '',
  pause: '',
  rest: '',
  note: '',
  priority: '1',
});
const segmentColumns: SheetColumn[] = [
  { key: 'exerciseName', label: 'Ejercicio', required: true },
  { key: 'count', label: 'Series', type: 'number', min: 1, max: 100, step: 1, required: true },
  { key: 'reps', label: 'Reps', type: 'number', min: 1, step: 1, required: true },
  { key: 'kg', label: 'Kg', type: 'number', min: 0.01 },
  { key: 'rpe', label: 'RPE objetivo', type: 'number', min: 1, max: 10 },
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
  {
    key: 'lift',
    label: 'Movimiento',
    type: 'select',
    options: [
      { value: '', label: 'Elegir…' },
      { value: 'SQ', label: 'Sentadilla' },
      { value: 'BP', label: 'Banca' },
      { value: 'DL', label: 'Peso muerto' },
      ...MOVEMENT_GROUPS.map((g) => ({ value: `acc:${g.value}`, label: `Accesorio · ${g.label}` })),
      { value: MOVEMENT_OTHER, label: 'Accesorio · otro' },
    ],
  },
  {
    key: 'mode',
    label: 'Modo',
    type: 'select',
    options: [
      { value: 'kg', label: 'Kg fijos' },
      { value: 'pct', label: 'Porcentaje' },
      { value: 'rpe', label: 'RPE' },
      { value: 'rpe_cap', label: 'RPE con tope' },
    ],
  },
  { key: 'pct', label: '%', type: 'number', min: 0.01, max: 150 },
  { key: 'ref', label: 'Referencia kg', type: 'number', min: 0.01 },
  { key: 'cap', label: 'Tope kg', type: 'number', min: 0.01 },
  { key: 'repsMax', label: 'Reps máx', type: 'number', min: 1, step: 1 },
  { key: 'variant', label: 'Variante' },
  { key: 'tempo', label: 'Tempo' },
  { key: 'pause', label: 'Pausa s', type: 'number', min: 0, step: 1 },
  { key: 'rest', label: 'Descanso s', type: 'number', min: 0, step: 1 },
  { key: 'note', label: 'Instrucciones' },
  {
    key: 'warmup',
    label: 'Aproximación',
    type: 'select',
    options: [
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Sí' },
    ],
  },
  { key: 'priority', label: 'Prioridad', type: 'number', min: 1, max: 5, step: 1, required: true },
];
export function CreateDialog({
  id,
  kind,
  mesos,
  macros,
  macro,
  block,
  week,
  all,
  onClose,
  onSaved,
}: {
  id: string;
  kind: 'macro' | 'meso' | 'session';
  all: SessionRow[];
  mesos: Meso[];
  macros: { id: string; name: string }[];
  macro: string;
  block: string;
  week: number;
  onClose: () => void;
  onSaved: (selection?: Record<string, string | null>) => void;
}) {
  const defaultName = kind === 'session' ? `Sesión ${block || 'nueva'} · S${week || 1}` : '';
  const [name, setName] = useState(defaultName);
  const [key, setKey] = useState(kind === 'meso' ? 'meso-' + crypto.randomUUID().slice(0, 8) : block);
  const [macroId, setMacro] = useState(macro);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState('');
  const [objective, setObjective] = useState('');
  const [status, setStatus] = useState('planificado');
  const [segments, setSegments] = useState<Segment[]>([newSegment()]);
  const [segmentGrid, setSegmentGrid] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  const [advanced, setAdvanced] = useState(false);
  const [quick, setQuick] = useState(true);
  const [quickText, setQuickText] = useState('');
  const [quickBad, setQuickBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creationPreview, setCreationPreview] = useState<ProgramResult | null>(null);
  const [review, setReview] = useState<KnownSet[] | null>(null);
  const [weekNo, setWeek] = useState(week);
  const [day, setDay] = useState(1);
  usePending(name !== defaultName || segments.some((s) => !!s.exerciseName));
  const build = () => {
    const sinMovimiento = segments.find((s) => s.exerciseName && !s.lift);
    if (sinMovimiento)
      throw new Error(
        `Elegí el movimiento de «${sinMovimiento.exerciseName}» (Sentadilla, Banca, Peso muerto o el grupo muscular del accesorio).`,
      );
    const sessionKey = 'session-' + crypto.randomUUID();
    let setNo = 0;
    return segments.flatMap((s, index) =>
      Array.from({ length: Number(s.count.replace(',', '.')) }, () => ({
        id: crypto.randomUUID(),
        sessionKey,
        slotKey: `${key}:w${weekNo}:d${day}:e${index}`,
        exposureId: `${key}:d${day}:${s.exerciseName}:${s.variant}`,
        variantKey: s.variant || s.exerciseName,
        exerciseName: s.exerciseName,
        lift: movementFields(s.lift).lift,
        plannedDate: start,
        blockKey: key,
        weekNo,
        dayNo: day,
        familyKey: key,
        setNo: ++setNo,
        reps: Number(s.reps.replace(',', '.')),
        plannedKg: s.kg ? Number(s.kg.replace(',', '.')) : null,
        targetRpe: s.rpe ? Number(s.rpe.replace(',', '.')) : null,
        refKg: s.ref ? Number(s.ref.replace(',', '.')) : null,
        isWarmup: s.warmup,
        priority: Number(s.priority.replace(',', '.')),
        protocol: {
          repsMax: s.repsMax ? Number(s.repsMax.replace(',', '.')) : null,
          loadMode: s.mode,
          muscleGroup: movementFields(s.lift).muscleGroup,
          segment: s.segment,
          pct: s.pct ? Number(s.pct.replace(',', '.')) : null,
          capKg: s.cap ? Number(s.cap.replace(',', '.')) : null,
          tempo: s.tempo || null,
          pauseSec: s.pause ? Number(s.pause.replace(',', '.')) : null,
          athleteProgression: (s.prog || null) as 'reps' | 'reps_kg' | null,
          athleteView: (s.view || null) as 'completo' | 'solo_rpe' | 'solo_carga' | 'rpe_porcentaje' | null,
          instructions: [s.rest ? `Descanso: ${s.rest} s.` : '', s.note].filter(Boolean).join(' ') || null,
        },
      })),
    );
  };
  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let selection: Record<string, string | null> = {};
      if (kind === 'macro') {
        const created = await send<{ id: string }>(id, 'macros', {
          name,
          startDate: start,
          endDate: end || null,
          objective: objective || null,
          status,
        });
        selection = { macro: created.id, block: null, week: null, session: null, context: '1' };
      } else if (kind === 'meso') {
        await send(
          id,
          'mesos',
          {
            blockKey: key,
            macroId: macroId || null,
            name,
            startDate: start || null,
            endDate: end || null,
            objective: objective || null,
          },
          'PUT',
        );
        selection = { macro: macroId || null, block: key, week: null, session: null, context: '1' };
      } else {
        if (!review) return;
        if (!creationPreview) throw new Error('Revisá la sesión antes de publicarla.');
        await w.program(id, {
          mode: 'apply',
          baseVersionId: creationPreview.baseVersionId,
          label: name || 'Nueva sesión',
          op: { type: 'add_sets', sets: review },
        });
        selection = {
          block: key,
          week: String(weekNo),
          session: review[0]?.sessionKey ?? null,
          context: '1',
        };
        rememberSets(id, review);
      }
      onSaved(selection);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        { macro: 'Crear macro', meso: 'Crear mesociclo', session: 'Nueva sesión · protocolos segmentados' }[
          kind
        ]
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (end && end < start) {
            setError('La fecha final debe ser posterior al inicio.');
            return;
          }
          if (kind === 'session') {
            for (const segment of segments) {
              const issue = validateRepsRange(segment.reps, segment.repsMax);
              if (issue) {
                setError(issue);
                return;
              }
            }
            for (const [i, segment] of segments.entries())
              for (const column of segmentColumns) {
                const issue = validateCell(String(segment[column.key as keyof Segment]), column);
                if (issue) {
                  setError(`Segmento ${i + 1}: ${issue}`);
                  return;
                }
              }
            const sets = build();
            setReview(null);
            setCreationPreview(null);
            setBusy(true);
            setError('');
            void w
              .program(id, { mode: 'preview', op: { type: 'add_sets', sets } })
              .then((p) => {
                setCreationPreview(p);
                setReview(sets);
              })
              .catch((e) => setError((e as Error).message))
              .finally(() => setBusy(false));
          } else void save();
        }}
      >
        <div className="form-grid">
          <label>
            {kind === 'session' ? 'Etiqueta de publicación' : 'Nombre'}
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Fecha de inicio
            <input
              required
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setReview(null);
                // la semana y el día salen de la fecha elegida (se pueden corregir a mano)
                if (kind === 'session' && e.target.value) {
                  const w = weekOfDate(all, key, e.target.value);
                  if (w) setWeek(w);
                  setDay(isoWeekday(e.target.value));
                }
              }}
            />
          </label>
          {kind !== 'session' && (
            <>
              <label>
                Fecha final (opcional)
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
              <label>
                Objetivo
                <input maxLength={120} value={objective} onChange={(e) => setObjective(e.target.value)} />
              </label>
            </>
          )}
          {kind === 'macro' && (
            <label>
              Estado
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="planificado">Planificado</option>
                <option value="activo">Activo</option>
                <option value="cerrado">Finalizado</option>
              </select>
            </label>
          )}
          {kind !== 'macro' && (
            <>
              <label>
                Macro
                <select value={macroId} onChange={(e) => setMacro(e.target.value)}>
                  <option value="">Sin macro asociado</option>
                  {macros.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Identificador de meso
                <input
                  required
                  list="mesos"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setReview(null);
                  }}
                />
                <datalist id="mesos">
                  {mesos.map((m) => (
                    <option key={m.blockKey} value={m.blockKey}>
                      {m.name}
                    </option>
                  ))}
                </datalist>
              </label>
            </>
          )}
          {kind === 'session' && (
            <>
              <label>
                Semana
                <input
                  required
                  type="number"
                  min={1}
                  value={weekNo}
                  onChange={(e) => {
                    setWeek(Number(e.target.value));
                    setReview(null);
                  }}
                />
              </label>
              <label>
                Día de distribución
                <input
                  type="number"
                  min={1}
                  max={7}
                  required
                  value={day}
                  onChange={(e) => {
                    setDay(Number(e.target.value));
                    setReview(null);
                  }}
                />
              </label>
            </>
          )}
        </div>
        {kind === 'meso' && mesos.some((m) => m.blockKey === key) && (
          <Message error>
            Ese identificador ya existe. Elegí uno nuevo para evitar sobrescribir sus metadatos.
          </Message>
        )}
        {kind === 'session' && (
          <>
            <p className="small muted">
              Cada segmento genera sus propias series. Podés combinar aproximaciones, top sets y backoffs.
              Descanso se guarda como instrucción; no existe campo estructurado en la API.
            </p>
            <div className="row sheet-layout-switch">
              <button
                type="button"
                className={quick ? 'on' : ''}
                onClick={() => {
                  const t = segmentsToText(segments);
                  if (t) setQuickText(t);
                  setQuickBad(false);
                  setQuick(true);
                }}
              >
                Texto rápido
              </button>
              <button
                type="button"
                className={!quick && segmentGrid ? 'on' : ''}
                onClick={() => {
                  setQuick(false);
                  setSegmentGrid(true);
                }}
              >
                Planilla de segmentos
              </button>
              <button
                type="button"
                className={!quick && !segmentGrid ? 'on' : ''}
                onClick={() => {
                  setQuick(false);
                  setSegmentGrid(false);
                }}
              >
                Formulario de segmentos
              </button>
            </div>
            {quick ? (
              <QuickEntry
                text={quickText}
                onText={setQuickText}
                disabled={busy}
                onSegments={(segs, ok) => {
                  setQuickBad(!ok);
                  if (!ok) return;
                  setSegments(segs.length ? segs.map((s) => ({ ...newSegment(), ...s })) : [newSegment()]);
                  setReview(null);
                  setCreationPreview(null);
                }}
              />
            ) : segmentGrid ? (
              <DataSheet
                label="Nueva sesión en planilla"
                columns={segmentColumns}
                disabled={busy}
                rows={segments.map((s, i) => ({ ...s, id: String(i), warmup: String(s.warmup) }))}
                onChange={(changes) => {
                  const next = segments.map((x) => ({ ...x }));
                  for (const c of changes)
                    Object.assign(next[c.row]!, {
                      [c.key]: c.key === 'warmup' ? c.value === 'true' : c.value,
                    });
                  setSegments(next);
                  setReview(null);
                  setCreationPreview(null);
                }}
              />
            ) : (
              <>
                <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
                  {advanced ? 'Ocultar campos avanzados' : 'Referencia, tempo y opciones avanzadas'}
                </button>
                {segments.map((s, i) => (
                  <fieldset key={i}>
                    <legend>Segmento {i + 1}</legend>
                    <div className="form-grid compact">
                      {(
                        [
                          'exerciseName',
                          'variant',
                          'count',
                          'reps',
                          'repsMax',
                          'kg',
                          'rpe',
                          'pct',
                          'ref',
                          'cap',
                          'tempo',
                          'pause',
                          'rest',
                          'priority',
                        ] as const
                      ).map((k) => (
                        <label
                          key={k}
                          hidden={
                            !advanced &&
                            [
                              'variant',
                              'pct',
                              'ref',
                              'cap',
                              'tempo',
                              'pause',
                              'rest',
                              'priority',
                              'repsMax',
                            ].includes(k) &&
                            !(
                              (s.mode === 'pct' && ['pct', 'ref'].includes(k)) ||
                              (s.mode === 'rpe_cap' && k === 'cap')
                            )
                          }
                        >
                          {
                            {
                              exerciseName: 'Ejercicio',
                              variant: 'Variante',
                              count: 'Series',
                              reps: 'Repeticiones',
                              repsMax: 'Repeticiones máximas (opcional)',
                              kg: 'Carga fija · kg',
                              rpe: 'RPE objetivo',
                              pct: 'Porcentaje',
                              ref: 'Referencia · kg',
                              cap: 'Tope · kg',
                              tempo: 'Tempo',
                              pause: 'Pausa · s',
                              rest: 'Descanso · s',
                              priority: 'Prioridad (1–5)',
                            }[k]
                          }
                          <input
                            required={['exerciseName', 'count', 'reps', 'priority'].includes(k)}
                            type={['exerciseName', 'variant', 'tempo'].includes(k) ? 'text' : 'number'}
                            min={
                              ['rpe', 'count', 'reps', 'repsMax', 'priority'].includes(k)
                                ? 1
                                : k === 'pause' || k === 'rest'
                                  ? 0
                                  : 0.01
                            }
                            max={
                              k === 'rpe'
                                ? 10
                                : k === 'priority'
                                  ? 5
                                  : k === 'pct'
                                    ? 150
                                    : k === 'count'
                                      ? 100
                                      : undefined
                            }
                            step={
                              ['count', 'reps', 'repsMax', 'priority', 'pause', 'rest'].includes(k)
                                ? 1
                                : 'any'
                            }
                            value={s[k]}
                            onChange={(e) => {
                              setSegments(
                                segments.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)),
                              );
                              setReview(null);
                            }}
                          />
                        </label>
                      ))}
                      <label>
                        Movimiento
                        <select
                          value={s.lift}
                          onChange={(e) => {
                            setSegments(
                              segments.map((x, j) => (j === i ? { ...x, lift: e.target.value } : x)),
                            );
                            setReview(null);
                          }}
                        >
                          <option value="">Elegir…</option>
                          <option value="SQ">Sentadilla</option>
                          <option value="BP">Banca</option>
                          <option value="DL">Peso muerto</option>
                          <optgroup label="Accesorio (grupo muscular)">
                            {MOVEMENT_GROUPS.map((g) => (
                              <option key={g.value} value={`acc:${g.value}`}>
                                {g.label}
                              </option>
                            ))}
                            <option value={MOVEMENT_OTHER}>Otro</option>
                          </optgroup>
                        </select>
                      </label>
                      <label>
                        Tipo
                        <select
                          value={s.segment}
                          onChange={(e) => {
                            setSegments(
                              segments.map((x, j) =>
                                j === i ? { ...x, segment: e.target.value as Segment['segment'] } : x,
                              ),
                            );
                            setReview(null);
                          }}
                        >
                          <option value="work">Trabajo</option>
                          <option value="top">Top set</option>
                          <option value="backoff">Backoff</option>
                        </select>
                      </label>
                      <label>
                        Carga
                        <select
                          value={s.mode}
                          onChange={(e) => {
                            setSegments(
                              segments.map((x, j) =>
                                j === i ? { ...x, mode: e.target.value as Segment['mode'] } : x,
                              ),
                            );
                            setReview(null);
                          }}
                        >
                          <option value="kg">Kg fijos</option>
                          <option value="pct">Porcentaje</option>
                          <option value="rpe">RPE</option>
                          <option value="rpe_cap">RPE con tope</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Instrucciones
                      <textarea
                        maxLength={450}
                        value={s.note}
                        onChange={(e) => {
                          setSegments(segments.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)));
                          setReview(null);
                        }}
                      />
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={s.warmup}
                        onChange={(e) => {
                          setSegments(
                            segments.map((x, j) => (j === i ? { ...x, warmup: e.target.checked } : x)),
                          );
                          setReview(null);
                        }}
                      />
                      Aproximación (excluida de dosis de trabajo)
                    </label>
                    <button
                      type="button"
                      disabled={segments.length === 1}
                      onClick={() => {
                        setSegments(segments.filter((_, j) => j !== i));
                        setReview(null);
                      }}
                    >
                      Quitar segmento
                    </button>
                  </fieldset>
                ))}
              </>
            )}
            {!quick && segmentGrid && (
              <button
                type="button"
                disabled={segments.length < 2}
                onClick={() => {
                  setSegments(segments.slice(0, -1));
                  setReview(null);
                  setCreationPreview(null);
                }}
              >
                Quitar último segmento
              </button>
            )}
            {!quick && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSegments([...segments, newSegment()]);
                    setReview(null);
                  }}
                >
                  ＋ Agregar segmento / ejercicio
                </button>
                <button
                  type="button"
                  title="Copia el último segmento (mismo ejercicio y protocolo) para cambiarle solo lo que varía"
                  onClick={() => {
                    setSegments([...segments, { ...segments[segments.length - 1]! }]);
                    setReview(null);
                  }}
                >
                  ⧉ Duplicar último segmento
                </button>
              </>
            )}
          </>
        )}
        <div className="sticky-actions">
          <span className="small muted">{review ? 'Revisión antes de publicar' : 'Cambios sin guardar'}</span>
          <button
            className="primary"
            disabled={
              busy ||
              (kind === 'meso' && mesos.some((m) => m.blockKey === key)) ||
              (kind === 'session' && quick && quickBad)
            }
          >
            {busy ? 'Guardando…' : kind === 'session' ? 'Revisar sesión' : 'Guardar'}
          </button>
        </div>
        {review && (
          <div className="preview">
            <h3>Revisar publicación</h3>
            <p>
              Destino: {key} · semana {weekNo} · {start}. {review.length} series nuevas, {segments.length}{' '}
              segmentos. Se agregan al plan vigente sin retirar otras series.
            </p>
            <p className="small muted">
              Vista previa calculada por el motor. Publicar verifica que el plan no haya cambiado.
            </p>
            {creationPreview?.preview.event.changes.map((c, i) => (
              <p className="small" key={i}>
                {c.summary}
              </p>
            ))}
            {creationPreview?.warnings?.map((x) => (
              <Message key={x}>{x}</Message>
            ))}
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
              Publicar sesión
            </button>
          </div>
        )}
        {error && <Message error>{error}</Message>}
      </form>
    </Modal>
  );
}
export function OperationDialog({
  id,
  type,
  sessions,
  block,
  week,
  session,
  onClose,
  onSaved,
}: {
  id: string;
  type: ProgramOpInput['op']['type'];
  sessions: SessionRow[];
  block: string;
  week: number;
  session: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [source, setSource] = useState(session);
  const [setIds, setSetIds] = useState<string[]>([]);
  const [target, setTarget] = useState(String(type === 'change_protocol' ? week : week + 1));
  const [date, setDate] = useState(shift(sessions.find((s) => s.sessionKey === source)?.date ?? today(), 7));
  const [replace, setReplace] = useState(false);
  const [template, setTemplate] = useState('');
  const [reps, setReps] = useState('');
  const [kg, setKg] = useState('');
  const [rpe, setRpe] = useState('');
  const [pct, setPct] = useState('');
  const [cap, setCap] = useState('');
  const [tempo, setTempo] = useState('');
  const [pause, setPause] = useState('');
  const [note, setNote] = useState('');
  const [variant, setVariant] = useState('');
  const [loadMode, setLoadMode] = useState('');
  const [exposure, setExposure] = useState('');
  const [preview, setPreview] = useState<ProgramResult | null>(null);
  const [request, setRequest] = useState<ProgramOpInput | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [evidence, setEvidence] = useState<ExposureDetail | null>(null);
  const templates = useLoad(() => get<{ id: string; name: string }[]>(id, 'templates'), [id]);
  const perf = useLoad(() => api.performance(id), [id]);
  const exposures = [
    ...new Set([
      ...Object.values(perf.data ?? {}).flatMap((x) => x?.exposures.map((e) => e.exposureId) ?? []),
      ...knownSets(id).flatMap((s) => (s.exposureId ? [s.exposureId] : [])),
    ]),
  ];
  const build = (): ProgramOpInput => {
    const base = { blockKey: block, replaceExisting: replace };
    const n = target.split(',').map((x) => Number(x.trim()));
    if (n.some((v) => !Number.isInteger(v) || v < 1))
      throw new Error('Los destinos deben ser semanas positivas separadas por comas.');
    let op: ProgramOpInput['op'];
    switch (type) {
      case 'duplicate_session':
        op = {
          type,
          sessionKey: source,
          newSessionKey: 'session-' + crypto.randomUUID(),
          plannedDate: date,
          blockKey: block,
          weekNo: n[0]!,
          replaceExisting: replace,
        };
        break;
      case 'repeat_week':
        op = { type, ...base, sourceWeek: week, targetWeek: n[0]!, targetStartDate: date };
        break;
      case 'repeat_structure':
        op = { type, ...base, sourceWeek: week, targetWeeks: n };
        break;
      case 'apply_template':
        op = { type, ...base, templateId: template, weekNo: n[0]!, startDate: date };
        break;
      case 'move_session':
        op = { type, sessionKey: source, plannedDate: date };
        break;
      case 'change_protocol': {
        const change: Extract<ProgramOpInput['op'], { type: 'change_protocol' }>['change'] = {};
        if (reps) change.reps = Number(reps);
        if (kg) change.plannedKg = Number(kg);
        if (rpe) change.targetRpe = Number(rpe);
        if (variant) change.variantKey = variant;
        if (pct || cap || tempo || pause || note || loadMode)
          change.protocol = {
            ...(pct ? { pct: Number(pct) } : {}),
            ...(cap ? { capKg: Number(cap) } : {}),
            ...(tempo ? { tempo } : {}),
            ...(pause ? { pauseSec: Number(pause) } : {}),
            ...(note ? { instructions: note } : {}),
            ...(loadMode ? { loadMode: loadMode as 'kg' | 'pct' | 'rpe' | 'rpe_cap' } : {}),
          };
        if (!Object.keys(change).length) throw new Error('Elegí al menos un campo a modificar.');
        op = {
          type,
          selection: {
            ...(setIds.length ? { setIds } : {}),
            blockKey: block,
            weeks: n,
            ...(source ? { sessionKeys: [source] } : {}),
            ...(exposure ? { exposureIds: [exposure] } : {}),
          },
          change,
        };
        break;
      }
    }
    return { mode: 'preview', label: 'Programación desde BASE', op };
  };
  const run = async (mode: 'preview' | 'draft' | 'apply') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const input = mode === 'preview' ? build() : request;
      if (!input) throw new Error('Revisá la operación primero.');
      const res = await w.program(id, { ...input, mode });
      setPreview(res);
      setRequest({ ...input, baseVersionId: res.baseVersionId });
      if (mode === 'apply' && res.baseVersionId === undefined)
        throw new Error('No se recibió la versión del plan.');
      if (mode !== 'preview') {
        setResult(
          mode === 'draft'
            ? 'Borrador guardado en el servidor. El plan vigente no cambió.'
            : 'Cambios publicados: versión e historial actualizados.',
        );
        setRequest(null);
        onSaved();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Cualquier edición invalida el preview y obliga a revisar el payload nuevo.
  const invalidate = () => {
    setPreview(null);
    setRequest(null);
    setResult('');
  };
  return (
    <Modal
      title={
        {
          duplicate_session: 'Duplicar sesión',
          repeat_week: 'Crear siguiente semana',
          repeat_structure: 'Repetir estructura',
          apply_template: 'Aplicar plantilla',
          change_protocol: 'Modificar protocolos',
          move_session: 'Mover sesión',
        }[type]
      }
      onClose={onClose}
    >
      <form
        onChange={invalidate}
        onSubmit={(e) => {
          e.preventDefault();
          void run('preview');
        }}
      >
        <p className="small muted">
          Origen: {block} · semana {week}. Solo programación: resultados, cuestionarios y completado
          permanecen separados.
        </p>
        <div className="form-grid">
          {['duplicate_session', 'change_protocol', 'move_session'].includes(type) && (
            <label>
              Sesión de origen / selección
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Todas las sesiones de las semanas destino</option>
                {sessions.map((s) => (
                  <option key={s.sessionKey} value={s.sessionKey}>
                    {s.date} · {s.exerciseName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type !== 'move_session' && (
            <label>
              Semana
              {['repeat_structure', 'change_protocol'].includes(type)
                ? 's destino (separadas por comas)'
                : ' destino'}
              <input required value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
          )}
          {['repeat_week', 'duplicate_session', 'apply_template', 'move_session'].includes(type) && (
            <label>
              Fecha destino
              <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          )}
          {type === 'apply_template' && (
            <label>
              Plantilla
              <select required value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">Elegí una plantilla</option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type === 'change_protocol' && (
            <>
              <label>
                Exposición (opcional)
                <select value={exposure} onChange={(e) => setExposure(e.target.value)}>
                  <option value="">Todas en la selección explícita</option>
                  {exposures.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              {(
                [
                  ['reps', 'Repeticiones', reps, setReps],
                  ['kg', 'Carga fija · kg', kg, setKg],
                  ['rpe', 'RPE objetivo', rpe, setRpe],
                  ['pct', 'Porcentaje', pct, setPct],
                  ['cap', 'Tope · kg', cap, setCap],
                  ['pause', 'Pausa · s', pause, setPause],
                ] as const
              ).map(([k, label, value, set]) => (
                <label key={k}>
                  {label}
                  <input
                    type="number"
                    min={k === 'pause' ? 0 : 0.01}
                    max={k === 'rpe' ? 10 : k === 'pct' ? 150 : undefined}
                    step="any"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                  />
                </label>
              ))}
              <label>
                Modelo de carga
                <select value={loadMode} onChange={(e) => setLoadMode(e.target.value)}>
                  <option value="">Conservar</option>
                  <option value="kg">Kg</option>
                  <option value="pct">Porcentaje</option>
                  <option value="rpe">RPE</option>
                  <option value="rpe_cap">RPE con tope</option>
                </select>
              </label>
              <label>
                Variante
                <input value={variant} onChange={(e) => setVariant(e.target.value)} />
              </label>
              <label>
                Tempo
                <input value={tempo} onChange={(e) => setTempo(e.target.value)} />
              </label>
              <label>
                Instrucciones / descanso
                <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </>
          )}
        </div>
        {type === 'change_protocol' && (
          <Message>
            Los campos vacíos se conservan. La modificación afecta todas las series que coincidan con semanas,
            sesión y exposición elegidas. Para acotar el cambio, abrí «Elegir series o segmentos concretos».
          </Message>
        )}
        {!['change_protocol', 'move_session'].includes(type) && (
          <label className="check">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            Autorizar reemplazo si el destino tiene programación publicada (se revisa antes de aplicar)
          </label>
        )}
        <button disabled={busy} className="primary">
          {busy ? 'Procesando…' : 'Previsualizar diferencias'}
        </button>
      </form>
      {type === 'change_protocol' && (
        <details className="segment-picker">
          <summary>Elegir series o segmentos concretos · {setIds.length || 'todas las coincidentes'}</summary>
          <p className="small muted">
            Sin selección individual se modifica toda la exposición elegida. Las series seleccionadas se
            limitan también a los destinos indicados.
          </p>
          {sessions
            .filter((s) => !source || s.sessionKey === source)
            .flatMap((s) =>
              s.sets.map((x) => (
                <label className="check" key={x.plannedSetId}>
                  <input
                    type="checkbox"
                    checked={setIds.includes(x.plannedSetId)}
                    onChange={(e) => {
                      setSetIds(
                        e.target.checked
                          ? [...setIds, x.plannedSetId]
                          : setIds.filter((id) => id !== x.plannedSetId),
                      );
                      invalidate();
                    }}
                  />
                  {x.exerciseName} · serie {x.setNo} · {x.protocol?.segment ?? 'trabajo'} · {x.planned.reps}{' '}
                  reps
                </label>
              )),
            )}
        </details>
      )}
      {type === 'change_protocol' && (
        <details>
          <summary>Consultar exposición anterior sin salir del editor</summary>
          <div className="row">
            <select
              aria-label="Exposición anterior"
              value={exposure}
              onChange={(e) => {
                setExposure(e.target.value);
                invalidate();
              }}
            >
              <option value="">Elegí una exposición</option>
              {exposures.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <button
              disabled={!exposure || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setEvidence(await w.exposure(id, exposure));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Consultar prescripción y ejecución
            </button>
          </div>
          {evidence !== null && <ExposureHistory value={evidence} />}
        </details>
      )}
      {preview && (
        <div className="preview">
          <h3>Diferencias previstas por el motor</h3>
          <p>
            {preview.preview.addedSets} series nuevas · {preview.preview.overwrites} series sobrescritas
          </p>
          {request && (
            <details>
              <summary>Origen, destinos y campos exactos</summary>
              <Detail value={request.op} />
            </details>
          )}
          {preview.preview.event.changes.map((c, i) => (
            <div key={i}>
              <strong>{c.summary}</strong>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Variable</th>
                      <th>Antes</th>
                      <th>Después</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.deltas.map((d, j) => (
                      <tr key={j}>
                        <td>
                          {d.variable} · {d.unit}
                        </td>
                        <td>{number(d.before)}</td>
                        <td>{number(d.after)}</td>
                        <td>{number(d.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {c.caveats.map((x) => (
                <p className="small muted" key={x}>
                  {x}
                </p>
              ))}
            </div>
          ))}
          <details>
            <summary>Disponibilidad de cálculos</summary>
            <Detail value={preview.preview.availability} />
          </details>
          <div className="row">
            <button disabled={busy || !request} onClick={() => void run('draft')}>
              Guardar borrador
            </button>
            <button className="primary" disabled={busy || !request} onClick={() => void run('apply')}>
              {preview.preview.overwrites
                ? 'Publicar y sobrescribir destinos revisados'
                : 'Publicar cambios revisados'}
            </button>
          </div>
        </div>
      )}
      {preview?.warnings?.map((x) => (
        <Message key={x}>{x}</Message>
      ))}
      {result && <Message>{result}</Message>}
      {error && <Message error>{error}</Message>}
    </Modal>
  );
}

function PriorityFilterBar() {
  const [prio, setPrio] = usePrio();
  return <PriorityFilter value={prio} onChange={setPrio} />;
}
