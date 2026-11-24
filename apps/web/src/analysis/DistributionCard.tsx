import { number } from '../workspace/ui';
import type { AnalysisResult, Source } from './types';

const PATTERN_LABEL: Record<string, string> = {
  sentadilla: 'Sentadilla',
  bisagra_cadera: 'Bisagra de cadera',
  unilateral_pierna: 'Unilateral de pierna',
  empuje_horizontal: 'Empuje horizontal',
  empuje_vertical: 'Empuje vertical',
  traccion_horizontal: 'Tracción horizontal',
  traccion_vertical: 'Tracción vertical',
  aislamiento_pierna: 'Aislamiento de pierna',
  aislamiento_brazos: 'Aislamiento de brazos',
  aislamiento_hombro_espalda: 'Aislamiento hombro-espalda',
  core: 'Core',
  transporte_olimpico: 'Transporte / olímpico',
};

function Bars({
  rows,
  source,
}: {
  rows: { key: string; label: string; real: number | null; plan: number | null }[];
  source: Source;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.real ?? 0, r.plan ?? 0]));
  return (
    <ul className="an-hbars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="lab">{r.label}</span>
          <span className="trk">
            {source !== 'plan' && r.real !== null && (
              <i className="real" style={{ width: `${(100 * r.real) / max}%` }} />
            )}
            {source !== 'real' && r.plan !== null && (
              <i className="plan" style={{ width: `${(100 * r.plan) / max}%` }} />
            )}
          </span>
          <span className="num">
            {source === 'plan' ? number(r.plan, 1) : number(r.real, 1)}
            {source === 'ambos' && r.plan !== null && <small> prev. {number(r.plan, 1)}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Distribución del volumen por grupo muscular y por patrón de movimiento (series), real y previsto por separado. */
export function DistributionCard({ data, source }: { data: AnalysisResult; source: Source }) {
  const a = data.distribution.actual;
  const p = data.distribution.planned;
  const planBy = new Map(p.muscles.map((m) => [m.muscle, m]));
  const muscles = a.muscles
    .map((m) => ({ ...m, plan: planBy.get(m.muscle)?.equivalentSets ?? null }))
    .filter((m) => m.equivalentSets > 0 || (m.plan ?? 0) > 0)
    .sort((x, y) => (source === 'plan' ? (y.plan ?? 0) - (x.plan ?? 0) : y.equivalentSets - x.equivalentSets))
    .slice(0, 14);
  const patBy = new Map(p.patterns.map((m) => [m.pattern, m]));
  const patterns = a.patterns
    .map((m) => ({ ...m, plan: patBy.get(m.pattern)?.sets ?? null }))
    .filter((m) => m.sets > 0 || (m.plan ?? 0) > 0)
    .sort((x, y) => y.sets - x.sets);
  const nothing = !muscles.length && !patterns.length;
  return (
    <section className="an-card" id="distribucion" aria-labelledby="h-distribucion">
      <header className="an-cardhead">
        <div>
          <h3 id="h-distribucion">Distribución</h3>
          <p>
            Series equivalentes por músculo (directas ×1,0 e indirectas ×0,5; los grupos se superponen, no se
            suman) y series por patrón de movimiento (cada ejercicio en un solo patrón).
          </p>
        </div>
      </header>
      {nothing ? (
        <p className="an-empty">Sin series en el período elegido.</p>
      ) : (
        <div className="an-two">
          <div>
            <h4 className="an-sub">Por grupo muscular</h4>
            <Bars
              source={source}
              rows={muscles.map((m) => ({
                key: m.muscle,
                label: m.label,
                real: m.equivalentSets,
                plan: m.plan,
              }))}
            />
            <div className="an-tablewrap">
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Músculo</th>
                    <th>Directas</th>
                    <th>Indirectas</th>
                    <th>
                      Equivalentes<small>real</small>
                    </th>
                    <th>
                      Equivalentes<small>previsto</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {muscles.map((m) => (
                    <tr key={m.muscle}>
                      <th scope="row">{m.label}</th>
                      <td className="num">{number(m.directSets, 1)}</td>
                      <td className="num">{number(m.indirectSets, 1)}</td>
                      <td className="num">{number(m.equivalentSets, 1)}</td>
                      <td className="num">{number(m.plan, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4 className="an-sub">Por patrón de movimiento</h4>
            <Bars
              source={source}
              rows={patterns.map((m) => ({
                key: m.pattern,
                label: PATTERN_LABEL[m.pattern] ?? m.pattern,
                real: m.sets,
                plan: m.plan,
              }))}
            />
            <div className="an-tablewrap">
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Patrón</th>
                    <th>Series</th>
                    <th>NL</th>
                    <th>
                      Tonelaje<small>kg</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {patterns.map((m) => (
                    <tr key={m.pattern}>
                      <th scope="row">{PATTERN_LABEL[m.pattern] ?? m.pattern}</th>
                      <td className="num">{number(m.sets, 0)}</td>
                      <td className="num">{number(m.nl, 0)}</td>
                      <td className="num">{number(m.tonnage, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {a.muscles.length > 0 && data.distribution.actual.weeks.length > 0 && (
        <p className="an-note">
          Suma del período elegido; las semanas parciales cuentan solo lo transcurrido.
        </p>
      )}
    </section>
  );
}
