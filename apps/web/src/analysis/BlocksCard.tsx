import { dateLabel, number } from '../workspace/ui';
import type { AnalysisResult, Lift } from './types';

const ROLE: Record<string, string> = {
  primaria: 'Primaria',
  secundaria: 'Secundaria',
  accesorio: 'Accesorio',
};
const EVENT: Record<string, string> = {
  new_variant: 'Nueva',
  removed_variant: 'Retirada',
  resumed_variant: 'Reintroducida',
  role_change: 'Cambio de rol',
  priority_change: 'Cambio de prioridad',
  slot_change: 'Cambio de posición',
};
const TTP: Record<string, string> = {
  delimitado: 'Delimitado',
  censurado: 'Censurado (el bloque cerró mejorando)',
  en_curso: 'En curso',
  insuficiente: 'Insuficiente',
  no_concluyente: 'No concluyente (pausa > 14 días)',
};
const GOLDEN: Record<string, string> = {
  sin_evidencia: 'Sin evidencia',
  exploratorio: 'Exploratorio (1 ciclo)',
  patron_repetido: 'Patrón repetido',
};
const PATTERN: Record<string, string> = {
  insuficiente: 'Insuficiente',
  observacion_preliminar: 'Observación preliminar',
  patron_repetido: 'Patrón repetido',
};
const SIDE: Record<string, string> = {
  favorable: 'Favorable',
  no_favorable: 'No favorable',
  indeterminado_por_faltantes: 'Indeterminado (faltan datos)',
  sin_benchmarks: 'Sin benchmarks',
};
const AGREE = { coinciden: 'Coinciden', difieren: 'Difieren', no_comparable: 'No comparable' };

/** Respuesta en e1RM de cada bloque: de la mediana inicial a la final. Descriptivo; sin cambio mínimo definido no se clasifica. */
function Response({ data, mov }: { data: AnalysisResult; mov: 'ALL' | Lift }) {
  const rows = data.summary.blocks.filter(
    (b) => (mov === 'ALL' || b.lift === mov) && b.eStart !== null && b.eEnd !== null,
  );
  if (!rows.length)
    return (
      <p className="an-empty">
        Sin bloques con 2N exposiciones comparables (con RPE real) para medir la respuesta.
      </p>
    );
  const lo = Math.min(...rows.flatMap((b) => [b.eStart as number, b.eEnd as number]));
  const hi = Math.max(...rows.flatMap((b) => [b.eStart as number, b.eEnd as number]));
  const span = hi - lo || 1;
  const x = (v: number) => 140 + ((v - lo) / span) * 520;
  const H = 26 * rows.length + 34;
  return (
    <>
      <svg
        viewBox={`0 0 720 ${H}`}
        className="an-dumbbell"
        role="img"
        aria-label="e1RM inicial y final por bloque"
      >
        <line x1={140} x2={660} y1={H - 22} y2={H - 22} className="ax" />
        <text x={140} y={H - 6} className="lbl">
          {number(lo, 0)} kg
        </text>
        <text x={660} y={H - 6} className="lbl" textAnchor="end">
          {number(hi, 0)} kg
        </text>
        {rows.map((b, i) => {
          const y = 18 + i * 26;
          const a = b.eStart as number;
          const z = b.eEnd as number;
          return (
            <g key={`${b.blockKey}${b.lift}`}>
              <text x={0} y={y + 4} className="lbl">
                {b.lift} · {b.blockKey}
              </text>
              <line x1={x(a)} x2={x(z)} y1={y} y2={y} className="rng" />
              <circle cx={x(a)} cy={y} r={4.5} className="from" />
              <circle cx={x(z)} cy={y} r={5.5} className="to" />
              <text x={x(Math.max(a, z)) + 12} y={y + 4} className="lbl">
                {number(a, 0)} a {number(z, 0)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="an-tablewrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Bloque</th>
              <th>Mov.</th>
              <th>Exposiciones</th>
              <th>
                E inicio<small>kg</small>
              </th>
              <th>
                E fin<small>kg</small>
              </th>
              <th>Cambio</th>
              <th>Cumplimiento</th>
              <th>Mejor momento</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {data.summary.blocks
              .filter((b) => mov === 'ALL' || b.lift === mov)
              .map((b) => (
                <tr key={`${b.blockKey}${b.lift}`} className={b.closed ? '' : 'future'}>
                  <th scope="row">
                    {b.blockKey}
                    <small>
                      {dateLabel(b.startDate)}–{dateLabel(b.endDate)}
                    </small>
                  </th>
                  <td>{b.lift}</td>
                  <td className="num">{b.comparableExposures}</td>
                  <td className="num">{number(b.eStart, 1)}</td>
                  <td className="num">{number(b.eEnd, 1)}</td>
                  <td className="num">
                    {b.eChange
                      ? `${b.eChange.kg > 0 ? '+' : ''}${number(b.eChange.kg, 1)} kg${b.eChange.pct === null ? '' : ` (${number(b.eChange.pct, 1)} %)`}`
                      : '—'}
                    {b.eChange && !b.eChange.defined && <small>sin cambio mínimo definido</small>}
                  </td>
                  <td className="num">
                    {b.compliance === null ? '—' : `${number(100 * b.compliance, 0)} %`}
                  </td>
                  <td className="num">{b.ttp.bestWeek === null ? '—' : `S${b.ttp.bestWeek}`}</td>
                  <td>
                    {TTP[b.ttp.state] ?? b.ttp.state}
                    {b.ttp.windowWeeks && (
                      <small>
                        ventana S{b.ttp.windowWeeks[0]}–S{b.ttp.windowWeeks[1]}
                      </small>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {data.summary.families.some((f) => mov === 'ALL' || f.lift === mov) && (
        <div className="an-tablewrap">
          <table className="an-table">
            <thead>
              <tr>
                <th>Familia de microciclo</th>
                <th>Mov.</th>
                <th>Ciclos</th>
                <th>Delimitados</th>
                <th>Patrón de TTP</th>
                <th>Microciclo «golden»</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.families
                .filter((f) => mov === 'ALL' || f.lift === mov)
                .map((f) => (
                  <tr key={`${f.familyKey}${f.lift}`}>
                    <th scope="row">{f.familyKey}</th>
                    <td>{f.lift}</td>
                    <td className="num">{f.cycles}</td>
                    <td className="num">{f.delimited}</td>
                    <td>{PATTERN[f.pattern] ?? f.pattern}</td>
                    <td>
                      {GOLDEN[f.golden] ?? f.golden}
                      {f.coachConfirmed && <small>confirmado por el coach</small>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="an-note">
        Un «mejor momento» no es un pico: si el bloque cierra mejorando queda censurado. No es el microciclo
        óptimo ni una causa demostrada.
      </p>
    </>
  );
}

/** Estructura de cada bloque por ejercicio: dosis semanal y cambios entre bloques vecinos. */
function Structure({ data, mov }: { data: AnalysisResult; mov: 'ALL' | Lift }) {
  const b = data.blocks;
  if (!b) return null;
  const cards = b.cards.filter((c) => mov === 'ALL' || c.lift === mov);
  if (!cards.length) return <p className="an-empty">Sin ejercicios en la ventana de bloques.</p>;
  const keys = b.window.blocks.map((x) => x.blockKey);
  const maxNl = Math.max(
    1,
    ...keys.map((k) => cards.filter((c) => c.blockKey === k).reduce((a, c) => a + c.nlPerWeek, 0)),
  );
  const changes = b.changes.filter(
    (c) => mov === 'ALL' || cards.some((x) => x.variantKey === c.variantKey) || c.event === 'removed_variant',
  );
  return (
    <>
      <ul className="an-stack">
        {b.window.blocks.map((blk, i) => {
          const cs = cards.filter((c) => c.blockKey === blk.blockKey);
          return (
            <li key={blk.blockKey}>
              <span className="lab">
                B{i} · {blk.blockKey}
              </span>
              <span className="trk">
                {cs.map((c, j) => (
                  <i
                    key={c.variantKey}
                    className={`seg s${j % 4}`}
                    style={{ width: `${(100 * c.nlPerWeek) / maxNl}%` }}
                    title={`${c.exerciseName}: ${number(c.nlPerWeek, 1)} NL/sem`}
                  />
                ))}
              </span>
              <span className="num">
                {number(
                  cs.reduce((a, c) => a + c.nlPerWeek, 0),
                  1,
                )}{' '}
                NL/sem
              </span>
            </li>
          );
        })}
      </ul>
      <div className="an-tablewrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Bloque</th>
              <th>Ejercicio</th>
              <th>Rol</th>
              <th>Prior.</th>
              <th>Series/sem</th>
              <th>NL/sem</th>
              <th>Ses./sem</th>
              <th>%1RM</th>
              <th>Cambios</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={`${c.blockKey}${c.variantKey}`}>
                <th scope="row">{c.blockKey}</th>
                <td>
                  {c.exerciseName}
                  {c.protocol && <small>{c.protocol}</small>}
                </td>
                <td>{c.role ? (ROLE[c.role] ?? c.role) : '—'}</td>
                <td className="num">{c.priority ?? '—'}</td>
                <td className="num">{number(c.setsPerWeek, 1)}</td>
                <td className="num">{number(c.nlPerWeek, 1)}</td>
                <td className="num">{number(c.sessionsPerWeek, 1)}</td>
                <td className="num">{c.intensityPct === null ? '—' : number(c.intensityPct, 1)}</td>
                <td>
                  {changes
                    .filter((x) => x.toBlock === c.blockKey && x.variantKey === c.variantKey)
                    .map((x) => (EVENT[x.event] ?? x.event) + (x.detail ? ` (${x.detail})` : ''))
                    .join(' · ') || '—'}
                </td>
              </tr>
            ))}
            {changes
              .filter((x) => x.event === 'removed_variant')
              .map((x) => (
                <tr key={`rm${x.toBlock}${x.variantKey}`} className="future">
                  <th scope="row">{x.toBlock}</th>
                  <td>{x.variantKey}</td>
                  <td colSpan={7}>Retirada respecto de {x.fromBlock}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Signal({ data }: { data: AnalysisResult }) {
  const s = data.blocks?.expression ?? [];
  if (!s.length) return null;
  return (
    <>
      <h4 className="an-sub">Señal de expresión (ventana favorable)</h4>
      <div className="an-tablewrap">
        <table className="an-table">
          <thead>
            <tr>
              <th>Mov.</th>
              <th>Modo B (principal)</th>
              <th>Modo A (contraste)</th>
              <th>Lectura</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {s.map((x) => (
              <tr key={x.lift}>
                <th scope="row">{x.lift}</th>
                <td>{SIDE[x.b.state]}</td>
                <td>{SIDE[x.a.state]}</td>
                <td>{AGREE[x.agreement]}</td>
                <td className="det">
                  <details>
                    <summary>Condiciones</summary>
                    <p>
                      <b>B</b>: {x.b.evidence.join(' · ') || '—'}
                      {x.b.missing.length > 0 && <> · falta: {x.b.missing.join('; ')}</>}
                    </p>
                    <p>
                      <b>A</b>: {x.a.evidence.join(' · ') || '—'}
                      {x.a.missing.length > 0 && <> · falta: {x.a.missing.join('; ')}</>}
                    </p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="an-note">
        Es una ventana favorable observada: no es un pico confirmado ni una predicción.
      </p>
    </>
  );
}

export function BlocksCard({ data, mov }: { data: AnalysisResult; mov: 'ALL' | Lift }) {
  return (
    <section className="an-card" id="bloques" aria-labelledby="h-bloques">
      <header className="an-cardhead">
        <div>
          <h3 id="h-bloques">Bloques y respuesta</h3>
          <p>Cómo respondió el e1RM en cada bloque, cómo se compone cada uno y si hubo ventana favorable.</p>
        </div>
      </header>
      <h4 className="an-sub">Respuesta por bloque y TTP</h4>
      <Response data={data} mov={mov} />
      <h4 className="an-sub">Estructura y cambios de ejercicio</h4>
      <Structure data={data} mov={mov} />
      <Signal data={data} />
    </section>
  );
}
