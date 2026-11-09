import { useEffect, useState } from 'react';
import type { SessionRow } from '@coaching/contracts';
import { api, request } from '../api/client';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { get, query, type Series, type Weekly } from './api';
import type { CoreSessions, Bundle } from './core';
import { OverviewChart, type Trace } from './OverviewChart';
import { number, readSearch, shift, updateSearch, Detail, Modal } from './ui';
import { MovementFilter, useMov } from './MovementFilter';
import type { EssentialProps } from './EssentialAnalysis';
const colors = ['var(--sq)', 'var(--bp)', 'var(--dl)', '#8b588c', '#4b858d', '#9c574e', '#6e7d3b'];
const lifts = ['SQ', 'BP', 'DL'] as const;
const categories = [
  ['SQ', 'Sentadilla · SQ'],
  ['BP', 'Banca · BP'],
  ['DL', 'Peso muerto · DL'],
  ['pull-h', 'Tracción horizontal'],
  ['pull-v', 'Tracción vertical'],
  ['push-h', 'Empuje horizontal · pectoral'],
  ['push-v', 'Empuje vertical · hombro'],
  ['other', 'Otros / sin organizar'],
] as const;
const patternCategory: Record<string, string> = {
  traccion_horizontal: 'pull-h',
  traccion_vertical: 'pull-v',
  empuje_horizontal: 'push-h',
  empuje_vertical: 'push-v',
};
const defaultCategory = (e: { lift: string | null; pattern?: string | null }) =>
  e.lift && lifts.includes(e.lift as (typeof lifts)[number])
    ? e.lift
    : (patternCategory[e.pattern ?? ''] ?? 'other');
const muscleNames: Record<string, string> = {
  cuadriceps: 'Cuádriceps',
  isquiotibiales: 'Isquios',
  core: 'Core',
  gluteos: 'Glúteos',
  aductores: 'Aductores',
  espalda_baja: 'Espalda baja',
  espalda_alta: 'Espalda alta',
  pectorales: 'Pectoral',
  pecho: 'Pectoral',
  deltoides_anterior: 'Deltoides anterior',
  deltoides_lateral: 'Deltoides lateral',
  deltoides_posterior: 'Deltoides posterior',
  dorsales: 'Dorsales',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  gemelos: 'Gemelos',
};
type Metric = 'si' | 'nl' | 'tonnage';
const value = (b: Bundle, m: Metric) => (m === 'si' ? b.si.rts.total : b[m]);
export function AnalysisOverview({ id, from, to, cutoff, onPeriod }: EssentialProps) {
  const [scale, setScale] = useState(readSearch().get('scale') === 'session' ? 'session' : 'week');
  useEffect(() => {
    const sync = () => setScale(readSearch().get('scale') === 'session' ? 'session' : 'week');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const [mov, setMov] = useMov();
  const [evidence, setEvidence] = useState<unknown>(null);
  const [siHelp, setSiHelp] = useState(false);
  const storage = `base:chart-groups:${id}`;
  const [groups, setGroups] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storage) ?? '{}');
    } catch {
      return {};
    }
  });
  const [groupError, setGroupError] = useState('');
  const data = useLoad(async () => {
    const [core, movement, series, sessions, weekly] = await Promise.all([
      get<CoreSessions>(id, 'core' + query({ from, to, cutoff, view: 'all' })),
      Promise.all(
        lifts.map((lift) => get<CoreSessions>(id, 'core' + query({ from, to, cutoff, lift, view: 'all' }))),
      ),
      get<Series>(id, 'series' + query({ from, to, cutoff })),
      api.sessions(id),
      get<Weekly[]>(id, 'weekly' + query({ from, to, cutoff })),
    ]);
    return { core, movement, series, sessions, weekly };
  }, [id, from, to, cutoff]);
  const scaleChange = (s: string) => {
    setScale(s);
    updateSearch({ scale: s }, true);
  };
  const points = (c: CoreSessions, m: Metric) =>
    scale === 'week'
      ? (c.weeks ?? []).map((w) => ({ date: w.week.from, value: value(w.totals, m).value }))
      : c.sessions.map((s) => ({ date: s.date, value: value(s.totals, m).value }));
  const setGroup = (k: string, v: string) => {
    const next = { ...groups, [k]: v };
    setGroups(next);
    try {
      localStorage.setItem(storage, JSON.stringify(next));
      setGroupError('');
    } catch {
      setGroupError('La organización se conserva solo en esta pantalla: el navegador no pudo guardarla.');
    }
  };
  return (
    <section className="analysis-overview">
      <div className="row between section-heading">
        <div>
          <h2>Entrenamiento en números</h2>
          <p className="small muted">Todos los gráficos juntos · valores realizados hasta {cutoff}</p>
        </div>
        <div className="row period-controls">
          <label>
            Desde
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => e.target.value && onPeriod(e.target.value, to)}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => e.target.value && onPeriod(from, e.target.value)}
            />
          </label>
          <div className="period-presets" role="group" aria-label="Períodos rápidos">
            {(
              [
                ['4 semanas', 28],
                ['3 meses', 91],
                ['6 meses', 182],
              ] as [string, number][]
            ).map(([name, days]) => (
              <button key={name} type="button" onClick={() => onPeriod(shift(cutoff, -days), cutoff)}>
                {name}
              </button>
            ))}
            <button
              type="button"
              className="on"
              disabled={!data.data?.sessions.length}
              title="Desde la primera sesión del plan hasta la fecha de análisis"
              onClick={() => {
                const first = (data.data?.sessions ?? []).map((x) => x.date).sort()[0];
                if (first) onPeriod(first < cutoff ? first : cutoff, cutoff);
              }}
            >
              Todo el plan
            </button>
          </div>
        </div>
      </div>
      <MovementFilter value={mov} onChange={setMov} />
      <div className="row between toolbar">
        <div className="row">
          <button className={scale === 'week' ? 'on' : ''} onClick={() => scaleChange('week')}>
            Semana a semana
          </button>
          <button className={scale === 'session' ? 'on' : ''} onClick={() => scaleChange('session')}>
            Sesión a sesión
          </button>
        </div>
        <span className="small muted">Mismo período para todos los gráficos · — sin cálculo</span>
      </div>
      <Async state={data}>
        {(d) => {
          const lens = mov === 'ALL' ? d.core : d.movement[lifts.indexOf(mov)]!;
          const exerciseKeys = [
            ...new Map(
              lens.sessions.flatMap((s) =>
                s.exercises.map((e) => [JSON.stringify([e.exerciseName, e.variantKey]), e] as const),
              ),
            ).entries(),
          ];
          const exercises = (category: string) =>
            exerciseKeys.filter(([k, e]) => (groups[k] ?? defaultCategory(e)) === category);
          const exerciseTrace = ([, e]: (typeof exerciseKeys)[number], index: number): Trace => ({
            label: `${e.exerciseName}${e.variantKey !== e.exerciseName ? ' · ' + e.variantKey : ''}`,
            color: colors[index % colors.length]!,
            points:
              scale === 'week'
                ? d.weekly
                    .filter(
                      (w) =>
                        w.movement.exerciseName === e.exerciseName && w.movement.variantKey === e.variantKey,
                    )
                    .map((w) => ({ date: w.week.from, value: w.actual.si_rts_total?.value ?? null }))
                : lens.sessions.map((s) => ({
                    date: s.date,
                    value:
                      s.exercises.find(
                        (x) => x.exerciseName === e.exerciseName && x.variantKey === e.variantKey,
                      )?.metrics.si.rts.total.value ?? null,
                  })),
          });
          const musclePeriods =
            scale === 'week'
              ? (lens.weeks ?? []).map((w) => ({ date: w.week.from, muscles: w.muscles }))
              : lens.sessions.map((s) => ({ date: s.date, muscles: s.muscles }));
          const convention = musclePeriods.find((p) => p.muscles.convention)?.muscles.convention;
          const muscleKeys = [
            ...new Set([
              'cuadriceps',
              'isquiotibiales',
              'core',
              ...musclePeriods.flatMap((p) => p.muscles.rows.map((m) => m.muscle)),
            ]),
          ];
          return (
            <>
              <div className="overview-grid overview-main">
                {(['si', 'nl', 'tonnage'] as const).map((m) => (
                  <article className="overview-panel" key={m}>
                    <div className="row between">
                      <h3>
                        {m === 'si'
                          ? 'SI · RTS aproximado'
                          : m === 'nl'
                            ? 'NL · repeticiones'
                            : 'Tonelaje · kg'}
                      </h3>
                      <button
                        className="help-button"
                        aria-label={`Datos de ${m}`}
                        onClick={() => {
                          setSiHelp(m === 'si');
                          setEvidence({
                            version: lens.version,
                            periodo: { from, to, cutoff },
                            definicion: m === 'si' ? 'rts-aprox-v1 · escalas SI no intercambiables' : m,
                            datos: scale === 'week' ? lens.weeks : lens.sessions,
                          });
                        }}
                      >
                        ?
                      </button>
                    </div>
                    {(scale === 'week'
                      ? (lens.weeks ?? []).map((w) => value(w.totals, m))
                      : lens.sessions.map((s) => value(s.totals, m))
                    ).some((v) => v.status !== 'available') && (
                      <p className="small">
                        Hay períodos sin cálculo o con datos parciales. Consultá la tabla y sus datos.
                      </p>
                    )}
                    <OverviewChart
                      period={{ from, to: to < cutoff ? to : cutoff }}
                      title={m.toUpperCase()}
                      unit={m === 'tonnage' ? 'kg' : m === 'nl' ? 'reps' : 'SI'}
                      traces={[
                        ...(mov === 'ALL'
                          ? [{ label: 'Total', color: '#78807c', points: points(lens, m), dashed: true }]
                          : []),
                        ...d.movement
                          .map((c, i) => ({
                            label: lifts[i]!,
                            color: colors[i]!,
                            points: points(c, m),
                            on: mov === 'ALL' || mov === lifts[i],
                          }))
                          .filter((t) => t.on),
                      ]}
                    />
                  </article>
                ))}
              </div>
              <div className="row between section-heading">
                <div>
                  <h3>SI por movimiento y patrón</h3>
                  <p className="small muted">
                    Mismo modelo en todos: rts-aprox-v1. Los patrones muestran ejercicios separados; no se
                    suman.
                  </p>
                </div>
                <details className="chart-organizer">
                  <summary>Organizar ejercicios por patrón</summary>
                  <p className="small muted">
                    La agrupación inicial usa el patrón oficial del motor. Estos ajustes organizan gráficos en
                    este navegador y no cambian su clasificación.
                  </p>
                  {exerciseKeys.map(([k, e]) => (
                    <label key={k}>
                      {e.exerciseName} · {e.variantKey}
                      <select
                        value={groups[k] ?? defaultCategory(e)}
                        onChange={(event) => setGroup(k, event.target.value)}
                      >
                        {categories.map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {groupError && <p role="alert">{groupError}</p>}
                </details>
              </div>
              <div className="overview-grid pattern-grid">
                {categories.map(([category, title]) => {
                  const canonical = lifts.indexOf(category as (typeof lifts)[number]);
                  if (mov !== 'ALL' && canonical >= 0 && category !== mov) return null;
                  const traces: Trace[] =
                    canonical >= 0
                      ? [
                          {
                            label: title,
                            color: colors[canonical]!,
                            points: points(d.movement[canonical]!, 'si'),
                          },
                        ]
                      : exercises(category).map(exerciseTrace);
                  if (mov !== 'ALL' && canonical < 0 && !traces.length) return null;
                  return (
                    <article className="overview-panel" key={category}>
                      <h4>{title}</h4>
                      {traces.length > 0 && (
                        <OverviewChart
                          period={{ from, to: to < cutoff ? to : cutoff }}
                          title={`SI ${title}`}
                          unit="SI"
                          traces={traces}
                        />
                      )}
                      {canonical < 0 && !traces.length && (
                        <p className="small muted">Sin ejercicios organizados en este patrón.</p>
                      )}
                      {canonical >= 0 && (
                        <small className="muted">
                          Total oficial del movimiento, incluidas sus variantes.
                        </small>
                      )}
                    </article>
                  );
                })}
              </div>
              <details className="overview-data">
                <summary>Volumen oficial por patrón · series, NL y tonelaje</summary>
                <p className="small muted">
                  Patrones sin superposición entre sí. No equivalen a grupos musculares ni a SQ/BP/DL.
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Patrón</th>
                        <th>Series</th>
                        <th>NL</th>
                        <th>Tonelaje · kg</th>
                        <th>Convención</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(scale === 'week'
                        ? (lens.weeks ?? []).map((w) => ({ date: w.week.from, patterns: w.patterns }))
                        : lens.sessions.map((s) => ({ date: s.date, patterns: s.patterns }))
                      ).flatMap(
                        (p, i) =>
                          p.patterns?.rows.map((r) => (
                            <tr key={i + r.pattern}>
                              <td>{p.date}</td>
                              <td>{r.pattern.replaceAll('_', ' ')}</td>
                              <td>{number(r.sets, 0)}</td>
                              <td>{number(r.nl, 0)}</td>
                              <td>{number(r.tonnage)}</td>
                              <td>{p.patterns?.convention.version}</td>
                            </tr>
                          )) ?? [],
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
              <div className="section-heading">
                <h3>Volumen por grupo muscular</h3>
                <p className="small muted">
                  Series equivalentes realizadas ·{' '}
                  {convention
                    ? `directas × ${number(convention.directWeight)} + indirectas × ${number(convention.indirectWeight)} · ${convention.version}`
                    : 'convención no informada'}
                  . Los grupos se superponen.
                </p>
                <p className="small">
                  El SI por músculo todavía no está calculado por el motor; acá se muestra volumen, no un
                  reparto estimado de SI.
                </p>
              </div>
              <div className="overview-grid muscle-grid">
                {muscleKeys.map((m, i) => (
                  <article className="overview-panel" key={m}>
                    <h4>{muscleNames[m] ?? m.replaceAll('_', ' ')}</h4>
                    <OverviewChart
                      period={{ from, to: to < cutoff ? to : cutoff }}
                      title={`Volumen ${m}`}
                      unit="series eq."
                      traces={[
                        {
                          label: 'Series equivalentes',
                          color: colors[i % colors.length]!,
                          points: musclePeriods.map((p) => ({
                            date: p.date,
                            value: p.muscles.rows.find((x) => x.muscle === m)?.equivalentSets ?? null,
                          })),
                        },
                      ]}
                    />
                    <details>
                      <summary>Reps y tonelaje equivalentes</summary>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Fecha</th>
                              <th>Series eq.</th>
                              <th>Reps eq.</th>
                              <th>Kg eq.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {musclePeriods.map((p, j) => {
                              const row = p.muscles.rows.find((x) => x.muscle === m);
                              return (
                                <tr key={j}>
                                  <td>{p.date}</td>
                                  <td>{number(row?.equivalentSets)}</td>
                                  <td>{number(row?.equivalentReps)}</td>
                                  <td>{number(row?.equivalentTonnage)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="small muted">
                        Aportes musculares; no son el NL o tonelaje total del movimiento.
                      </p>
                    </details>
                  </article>
                ))}
              </div>
              {!!lens.sessions.flatMap((s) => s.muscles.unmappedExercises).length && (
                <p className="small">
                  Ejercicios sin mapeo muscular:{' '}
                  {[...new Set(lens.sessions.flatMap((s) => s.muscles.unmappedExercises))].join(', ')}.
                </p>
              )}
              <div className="section-heading">
                <h3>Fuerza · marcas realizadas y e1RM</h3>
                <p className="small muted">
                  Métodos separados. Un e1RM y un single submáximo no son un test de 1RM validado.
                </p>
              </div>
              <div className="overview-grid force-grid">
                {exerciseKeys.map(([k, e]) => {
                  const methods = d.series.performance.filter(
                    (p) => p.exercise === e.exerciseName && p.variantKey === e.variantKey,
                  );
                  const singles = realSingles(d.sessions, e.exerciseName, e.variantKey, from, to, cutoff);
                  return (
                    <article className="overview-panel" key={k}>
                      <h4>
                        {e.exerciseName}
                        {e.variantKey !== e.exerciseName ? ' · ' + e.variantKey : ''}
                      </h4>
                      <OverviewChart
                        period={{ from, to: to < cutoff ? to : cutoff }}
                        title={`Fuerza ${e.exerciseName}`}
                        unit="kg"
                        traces={[
                          ...methods.map((p, j) => ({
                            label: p.methodId === 'table-rpe' ? 'e1RM · curva RPE' : 'e1RM · 6 fórmulas',
                            color: colors[j]!,
                            dashed: j > 0,
                            points: p.points.map((x) => ({ date: x.date, value: x.value })),
                          })),
                          { label: 'Single realizado', color: '#242b28', dotsOnly: true, points: singles },
                        ]}
                      />
                      <small className="muted">
                        {methods.map((p) => `${p.methodId} · ${p.methodVersion}`).join(' / ') ||
                          'Sin estimaciones'}
                        {!singles.length ? ' · Sin singles realizados en sesiones programadas' : ''}
                      </small>
                    </article>
                  );
                })}
              </div>
              <details className="overview-data">
                <summary>{scale === 'week' ? 'Tabla semanal' : 'Tabla por sesión'} y datos oficiales</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>SI</th>
                        <th>NL</th>
                        <th>Tonelaje</th>
                        <th>Datos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(scale === 'week'
                        ? (lens.weeks ?? []).map((w) => ({
                            key: w.week.from,
                            date: w.week.from + (w.week.partial ? ' · parcial' : ''),
                            totals: w.totals,
                          }))
                        : lens.sessions.map((s) => ({
                            key: s.key,
                            date: s.date + ' · ' + s.sessionKey,
                            totals: s.totals,
                          }))
                      ).map((r) => (
                        <tr key={r.key}>
                          <td>{r.date}</td>
                          {(['si', 'nl', 'tonnage'] as const).map((m) => (
                            <td key={m}>
                              {number(value(r.totals, m).value)}
                              {value(r.totals, m).status === 'partial' ? ' · parcial' : ''}
                            </td>
                          ))}
                          <td>
                            <button onClick={() => setEvidence(r)}>Ver datos</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          );
        }}
      </Async>
      {evidence !== null && (
        <Modal
          title="Datos del gráfico"
          onClose={() => {
            setEvidence(null);
            setSiHelp(false);
          }}
        >
          {siHelp && <SiMethodDetails />}
          <Detail value={evidence} />
        </Modal>
      )}
    </section>
  );
}
function realSingles(
  sessions: SessionRow[],
  exercise: string,
  variant: string,
  from: string,
  to: string,
  cutoff: string,
) {
  return sessions
    .flatMap((s) =>
      s.sets.flatMap((x) => {
        const a = x.actual;
        const date = a?.performedOn ?? s.date;
        return !x.isWarmup &&
          x.exerciseName === exercise &&
          x.variantKey === variant &&
          a?.status === 'done' &&
          a.reps === 1 &&
          a.kg !== null &&
          date >= from &&
          date <= to &&
          date <= cutoff
          ? [{ date, value: a.kg }]
          : [];
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

function SiMethodDetails() {
  const state = useLoad(
    () => request<{ model: string; revision?: string; version: string }>('/api/tables/si/rts'),
    [],
  );
  return (
    <Async state={state}>
      {(d) => (
        <p className="small">
          Modelo {d.model} · revisión {d.revision ?? 'no informada'} · tablas {d.version}
        </p>
      )}
    </Async>
  );
}
