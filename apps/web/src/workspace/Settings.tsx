import { useState } from 'react';
import { AthleteAccess } from './AthleteAccess';
import type { AthleteDetail } from '@coaching/contracts';
import { ParamsEditor } from '../components/ParamsEditor';
import { api } from '../api/client';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { get, send, workspaceApi as w } from './api';
import { Detail, Message, today, number } from './ui';
interface ImportResponse {
  preview?: {
    token: string;
    newRows: number;
    duplicatesExisting: number;
    rejected: number;
    fatal: string[];
    exercises: { title: string; lift: string | null; variantKey: string; loadKind: string }[];
    [key: string]: unknown;
  };
  parse?: { ok: boolean; errors: unknown[]; warnings: string[]; summary: unknown; availability: unknown };
  token?: string;
  applied: unknown;
}
export function Settings({
  id,
  athlete,
  onChanged,
}: {
  id: string;
  athlete: AthleteDetail;
  onChanged: () => void;
}) {
  const [view, setView] = useState('references');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const refs = useLoad(() => w.references(id), [id, message]);
  const [exercise, setExercise] = useState(athlete.competitionExercises.SQ ?? '');
  const [kg, setKg] = useState('');
  const [date, setDate] = useState(today());
  const [source, setSource] = useState('decision_del_coach');
  const [note, setNote] = useState('');
  return (
    <section>
      <h2>Configuración y datos</h2>
      <div className="row tabs">
        {[
          ['references', 'Referencias de fuerza'],
          ['params', 'Parámetros del atleta'],
          ['imports', 'Importaciones'],
          ['access', 'Acceso del atleta'],
        ].map(([v, l]) => (
          <button key={v} className={v === view ? 'on' : ''} onClick={() => setView(v!)}>
            {l}
          </button>
        ))}
      </div>
      {error && <Message error>{error}</Message>}
      {message && <Message>{message}</Message>}
      {view === 'references' && (
        <>
          <Message>
            La referencia es fechada y específica del ejercicio. Afecta la intensidad relativa y protocolos
            por porcentaje; no es necesariamente una marca real. Guardarla no reescribe evaluaciones cerradas.
          </Message>
          <form
            className="card"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError('');
              try {
                await send(id, 'references', {
                  exerciseName: exercise,
                  kg: Number(kg),
                  source,
                  asOf: date,
                  note,
                });
                setMessage('Referencia guardada · ' + new Date().toLocaleTimeString('es-AR'));
                onChanged();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-grid">
              <label>
                Ejercicio exacto
                <input required value={exercise} onChange={(e) => setExercise(e.target.value)} />
              </label>
              <label>
                Referencia · kg
                <input
                  required
                  type="number"
                  min={0.01}
                  max={1000}
                  step="any"
                  value={kg}
                  onChange={(e) => setKg(e.target.value)}
                />
              </label>
              <label>
                Vigente desde
                <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                Origen
                <select value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="decision_del_coach">Decisión del coach</option>
                  <option value="test">Test</option>
                  <option value="competencia">Competencia</option>
                  <option value="estimada_curva">Estimación por curva</option>
                  <option value="estimada_formula">Estimación por fórmula</option>
                </select>
              </label>
            </div>
            <label>
              Nota opcional
              <textarea maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar referencia'}
            </button>
          </form>
          <Async state={refs}>
            {(list) => (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ejercicio</th>
                      <th>Referencia</th>
                      <th>Origen</th>
                      <th>Fecha</th>
                      <th>Nota</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r, i) => (
                      <tr key={i}>
                        <td>{r.exerciseName}</td>
                        <td>{number(r.kg)} kg</td>
                        <td>{r.source}</td>
                        <td>{r.asOf}</td>
                        <td>{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!list.length && <p className="muted">Todavía no hay referencias.</p>}
              </div>
            )}
          </Async>
        </>
      )}
      {view === 'params' && (
        <>
          <Message>
            Alcance: este atleta y, cuando se indica, un movimiento o familia. Los cambios se interpretan al
            re-evaluar. La API valida rangos; el catálogo de parámetros completo aún no se expone por HTTP.
          </Message>
          <ParamsEditor
            params={athlete.params}
            families={athlete.evaluation?.families.map((x) => x.familyKey) ?? []}
            onSave={async (p) => {
              setError('');
              try {
                await api.saveParams(id, p);
                setMessage('Parámetros guardados; re-evaluá para actualizar conclusiones.');
                onChanged();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        </>
      )}
      {view === 'imports' && <Imports id={id} />}
      {view === 'access' && <AthleteAccess id={id} />}
    </section>
  );
}
function Imports({ id }: { id: string }) {
  const [kind, setKind] = useState('hevy');
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [replace, setReplace] = useState(false);
  const [status, setStatus] = useState('borrador');
  const [mapping, setMapping] = useState<
    Record<string, { lift: 'SQ' | 'BP' | 'DL' | null; variantKey?: string; loadKind?: string }>
  >({});
  const [revision, setRev] = useState(0);
  const [needsPreview, setNeedsPreview] = useState(false);
  const batches = useLoad(() => get<unknown>(id, 'imports'), [id, revision]);
  const maps = useLoad(
    () =>
      get<Record<string, { lift: string | null; variantKey?: string; loadKind?: string }>>(
        id,
        'imports/hevy/exercise-map',
      ),
    [id, revision],
  );
  const reset = () => {
    setPreview(null);
    setNeedsPreview(false);
    setMessage('');
  };
  const run = async (mode: 'dry_run' | 'apply') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const token = preview?.preview?.token ?? preview?.token;
      const r = await send<ImportResponse>(id, `imports/${kind}`, {
        csv,
        mode,
        ...(kind === 'hevy' ? { exerciseMap: mapping } : { status, replace }),
        ...(mode === 'apply' ? { confirmToken: token } : {}),
      });
      setPreview(r);
      setNeedsPreview(false);
      if (mode === 'apply') {
        setMessage('Importación aplicada. Re-evaluá para actualizar las conclusiones.');
        setRev((x) => x + 1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const blocked = preview?.parse ? !preview.parse.ok : !!preview?.preview?.fatal.length;
  return (
    <div>
      <Message>
        Importación local. El dry-run no escribe. Aplicar exige el token del mismo archivo y opciones. No se
        carga ningún archivo a servicios externos.
      </Message>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void run('dry_run');
        }}
      >
        <div className="form-grid">
          <label>
            Formato
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                reset();
              }}
            >
              <option value="hevy">Exportación Hevy · CSV</option>
              <option value="plan-csv">Plan canónico · plan-canonical-v1</option>
            </select>
          </label>
          <label>
            Archivo CSV
            <input
              required
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 20000000) {
                  setError('El archivo supera 20 MB.');
                  return;
                }
                setCsv(await f.text());
                setFile(f.name);
                reset();
              }}
            />
          </label>
          {kind === 'plan-csv' && (
            <label>
              Destino
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  reset();
                }}
              >
                <option value="borrador">Borrador</option>
                <option value="aplicado">Plan publicado</option>
              </select>
            </label>
          )}
        </div>
        {kind === 'plan-csv' && (
          <label className="check">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => {
                setReplace(e.target.checked);
                reset();
              }}
            />
            Reemplazar plan completo: las series ausentes se retiran. Requiere revisión explícita.
          </label>
        )}
        <button disabled={busy || !csv} className="primary">
          {busy ? 'Procesando…' : 'Analizar archivo (dry-run)'}
        </button>
        <span className="muted small"> {file}</span>
      </form>
      {preview && (
        <div className="preview">
          <h3>Resumen de importación</h3>
          {preview.preview && (
            <>
              <div className="dose-grid">
                <div>
                  <strong>{preview.preview.newRows}</strong>
                  <small>nuevas</small>
                </div>
                <div>
                  <strong>{preview.preview.duplicatesExisting}</strong>
                  <small>duplicadas</small>
                </div>
                <div>
                  <strong>{preview.preview.rejected}</strong>
                  <small>rechazadas</small>
                </div>
              </div>
              <details open>
                <summary>Mapeo revisable de ejercicios</summary>
                {preview.preview.exercises.map((x, i) => (
                  <div className="row mapping-row" key={i}>
                    <strong>{x.title}</strong>
                    <label>
                      Movimiento
                      <select
                        value={mapping[x.title] ? (mapping[x.title]!.lift ?? '') : (x.lift ?? '')}
                        onChange={(e) => {
                          setMapping({
                            ...mapping,
                            [x.title]: {
                              ...mapping[x.title],
                              lift: (e.target.value || null) as 'SQ' | 'BP' | 'DL' | null,
                            },
                          });
                          setNeedsPreview(true);
                        }}
                      >
                        <option value="">Sin lift</option>
                        <option value="SQ">Sentadilla</option>
                        <option value="BP">Banca</option>
                        <option value="DL">Peso muerto</option>
                      </select>
                    </label>
                    <label>
                      Variante
                      <input
                        value={mapping[x.title]?.variantKey ?? x.variantKey}
                        onChange={(e) => {
                          setMapping({
                            ...mapping,
                            [x.title]: {
                              lift: (x.lift || null) as 'SQ' | 'BP' | 'DL' | null,
                              ...mapping[x.title],
                              variantKey: e.target.value,
                            },
                          });
                          setNeedsPreview(true);
                        }}
                      />
                    </label>
                    <label>
                      Tipo de carga
                      <select
                        value={mapping[x.title]?.loadKind ?? x.loadKind}
                        onChange={(e) => {
                          setMapping({
                            ...mapping,
                            [x.title]: {
                              lift: (x.lift || null) as 'SQ' | 'BP' | 'DL' | null,
                              ...mapping[x.title],
                              loadKind: e.target.value,
                            },
                          });
                          setNeedsPreview(true);
                        }}
                      >
                        {[
                          'total',
                          'per_side',
                          'machine',
                          'bodyweight',
                          'added_bodyweight',
                          'assisted',
                          'unknown',
                        ].map((v) => (
                          <option key={v} value={v}>
                            {
                              (
                                {
                                  total: 'Total',
                                  per_side: 'Por lado',
                                  machine: 'Máquina',
                                  bodyweight: 'Peso corporal',
                                  added_bodyweight: 'Lastre',
                                  assisted: 'Asistida',
                                  unknown: 'Desconocida',
                                } as Record<string, string>
                              )[v]
                            }
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
                <p className="small muted">
                  Cambiar el mapeo invalida el dry-run. Volvé a analizar para revisar el nuevo resultado.
                </p>
              </details>
            </>
          )}
          <details open>
            <summary>Errores, rechazos, huecos y disponibilidad</summary>
            <Detail
              value={
                preview.parse ??
                Object.fromEntries(
                  Object.entries(preview.preview ?? {}).filter(
                    ([k]) => !['token', 'exercises', 'sample'].includes(k),
                  ),
                )
              }
            />
          </details>
          {needsPreview && <Message>Mapeo modificado: volvé a analizar el archivo antes de aplicar.</Message>}
          {preview.applied ? (
            <Message>
              Resultado: <Detail value={preview.applied} />
            </Message>
          ) : (
            <button
              disabled={busy || blocked || needsPreview}
              className="primary"
              onClick={() => void run('apply')}
            >
              {replace
                ? 'Confirmar importación y reemplazo completo revisado'
                : 'Confirmar aplicación de esta importación'}
            </button>
          )}
        </div>
      )}
      {message && <Message>{message}</Message>}
      {error && <Message error>{error}</Message>}
      <details>
        <summary>Mapeo persistente y lotes importados</summary>
        <Async state={maps}>{(m) => <Detail value={m} />}</Async>
        <Async state={batches}>{(b) => <Detail value={b} />}</Async>
      </details>
    </div>
  );
}
