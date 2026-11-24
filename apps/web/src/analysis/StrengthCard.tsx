import { useState } from 'react';
import { E1rmChart, type CBlock, type CVariant } from '../workspace/BlockCharts';
import type { Annotation } from '../workspace/OverviewChart';
import { PerformanceCurve } from '../performance/PerformanceCurve';
import { dateLabel, number } from '../workspace/ui';
import type { AnalysisMetric, AnalysisResult, Lift } from './types';
import type { AnalysisState } from './state';

const LIFT_NAME: Record<Lift, string> = { SQ: 'Sentadilla', BP: 'Banca', DL: 'Peso muerto' };
const RECORD_TYPE: Record<string, string> = {
  single: 'Single',
  load_for_reps: 'Carga para reps',
  reps_at_load: 'Reps con carga',
  rpe_comparable: 'Marca a un RPE',
};

/**
 * Fuerza: e1RM por variante (curva RPE con RPE real), con su tabla, los récords reales y las referencias.
 * La proyección experimental es una capa opcional del mismo gráfico (nunca un segundo gráfico de lo mismo).
 */
export function StrengthCard({
  data,
  mov,
  state,
  marks,
  metric,
  asOf,
  from,
  to,
}: {
  data: AnalysisResult;
  mov: 'ALL' | Lift;
  state: AnalysisState;
  marks: Annotation[];
  metric: AnalysisMetric | undefined;
  asOf: string;
  from: string;
  to: string;
}) {
  const [projVariant, setProjVariant] = useState('');
  const b = data.blocks;
  const lifts: Lift[] = mov === 'ALL' ? ['SQ', 'BP', 'DL'] : [mov];
  const variants = ((b?.variants ?? []) as unknown as CVariant[]).filter(
    (v) => lifts.includes(v.lift as Lift) && v.weekly.length,
  );
  const blocks = (b?.window.blocks ?? []) as CBlock[];
  const rows = variants.flatMap((v) => v.weekly.map((p) => ({ v, p })));
  const names = new Map(variants.map((v) => [v.variantKey, v.exerciseName]));
  const recs = data.records
    .filter((r) => r.isRealPR && names.has(r.variantKey) && r.type !== 'best_e1rm')
    .slice(0, 12);
  const refs = data.references.filter((r) => variants.some((v) => v.exerciseName === r.exercise));
  const chosen = variants.find((v) => v.variantKey === projVariant);

  return (
    <section className="an-card" id="fuerza" aria-labelledby="h-fuerza">
      <header className="an-cardhead">
        {metric && (
          <label className="an-all" title="Elegir el e1RM para la comparativa">
            <input
              type="checkbox"
              checked={state.sel.includes(metric.id)}
              onChange={() => state.toggle([metric.id])}
              aria-label="Elegir e1RM para comparar"
            />
          </label>
        )}
        <div>
          <h3 id="h-fuerza">Fuerza</h3>
          <p>
            e1RM semanal por variante (curva con RPE real). Un e1RM no es un récord real: los récords van
            aparte y no se mezclan variantes.
          </p>
        </div>
      </header>
      {!variants.length ? (
        <p className="an-empty">No hay series con RPE real para estimar el e1RM en la ventana de bloques.</p>
      ) : (
        <>
          {lifts.map((l) => (
            <E1rmChart key={l} lift={l} variants={variants} blocks={blocks} marks={marks} />
          ))}
          <div className="an-tablewrap">
            <table className="an-table">
              <thead>
                <tr>
                  <th>Variante</th>
                  <th>Bloque · sem.</th>
                  <th>Fecha</th>
                  <th>
                    e1RM<small>kg</small>
                  </th>
                  <th>Sesiones</th>
                  <th>RPE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ v, p }) => {
                  const best = v.bestWeek === p.week && v.bestKg === p.e1rm;
                  return (
                    <tr key={`${v.variantKey}${v.blockKey}${p.week}`}>
                      <th scope="row">{v.exerciseName}</th>
                      <td>
                        {v.blockKey} · S{p.week}
                      </td>
                      <td>{dateLabel(p.lastDate)}</td>
                      <td className="num">
                        <span className={best ? 'e1rm-max' : ''}>{number(p.e1rm, 1)}</span>
                      </td>
                      <td className="num">{p.n}</td>
                      <td className="num">{p.rpeMin === p.rpeMax ? p.rpeMin : `${p.rpeMin}–${p.rpeMax}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!!recs.length && (
            <>
              <h4 className="an-sub">Récords reales</h4>
              <div className="an-tablewrap">
                <table className="an-table">
                  <thead>
                    <tr>
                      <th>Ejercicio</th>
                      <th>Tipo</th>
                      <th>Condición</th>
                      <th>Valor</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recs.map((r, i) => (
                      <tr key={i}>
                        <th scope="row">{names.get(r.variantKey) ?? r.exercise}</th>
                        <td>{RECORD_TYPE[r.type] ?? r.type}</td>
                        <td>
                          {r.key.replace('reps=', '≥ ').replace('@rpe=', ' @ RPE ').replace('kg=', '≥ ')}
                        </td>
                        <td className="num">
                          {number(r.value, r.unit === 'reps' ? 0 : 1)} {r.unit}
                        </td>
                        <td>{dateLabel(r.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!!refs.length && (
            <p className="an-note">
              Referencias de fuerza vigentes:{' '}
              {refs.map((r) => `${r.exercise} ${number(r.kg, 1)} kg (${dateLabel(r.date)})`).join(' · ')}.
            </p>
          )}
          <div className="an-layer">
            <label>
              <span>Proyección experimental (capa opcional)</span>
              <select value={projVariant} onChange={(e) => setProjVariant(e.target.value)}>
                <option value="">Sin proyección</option>
                {variants.map((v) => (
                  <option key={v.variantKey} value={v.variantKey}>
                    {LIFT_NAME[v.lift as Lift]} · {v.exerciseName}
                  </option>
                ))}
              </select>
            </label>
            {chosen && (
              <PerformanceCurve
                id={data.athleteId}
                exercise={chosen.exerciseName}
                variant={chosen.variantKey}
                method="table-rpe"
                from={from}
                to={to}
                cutoff={asOf}
                historical={chosen.weekly.map((p) => ({ date: p.lastDate, value: p.e1rm }))}
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
