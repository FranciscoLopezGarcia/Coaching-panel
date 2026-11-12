import { useMemo, useState } from 'react';
import {
  applyMeta,
  MOVEMENT_GROUPS,
  parseQuickSession,
  type ExMeta,
  type QuickSegment,
} from './quickSession';
import { VIEW_LABEL } from './AthleteAccess';

const RESTS = [30, 45, 60, 90, 120, 150, 180, 240, 300];

const EXAMPLES = [
  { n: 'Rampa de RPE', t: '1° Squat comp 3x5@4-5-6' },
  { n: 'Top set + backoff', t: '1° Bench comp 1x3@8 top + 3x5@7 backoff' },
  { n: 'Rango y RIR', t: 'Remo barra 3x10-12 RIR2' },
  { n: 'Cargas por serie', t: 'Deadlift comp 3x3x180-190-200' },
];
const movementLabel = (m: string) =>
  ({ SQ: 'Sentadilla', BP: 'Banca', DL: 'Peso muerto', '': 'Elegir…' })[m] ??
  `Accesorio · ${MOVEMENT_GROUPS.find((g) => `acc:${g.value}` === m)?.label ?? 'otro'}`;

/**
 * Entrada rápida por texto: una línea por ejercicio. Mientras escribís se interpreta y se muestra qué se entendió.
 * No guarda nada: pasa los segmentos a la planilla de la sesión, donde se revisa y se publica como siempre.
 */
export function QuickEntry({
  text,
  onText,
  onSegments,
  disabled,
  initialMeta,
  onMeta,
  defaultViewLabel,
}: {
  text: string;
  onText: (t: string) => void;
  onSegments: (segs: QuickSegment[], ok: boolean) => void;
  disabled?: boolean;
  /** Descanso y vista del atleta ya vigentes por ejercicio (al editar una sesión). */
  initialMeta?: ExMeta;
  onMeta?: (m: ExMeta) => void;
  /** Texto de «lo habitual» (vista por defecto del atleta). */
  defaultViewLabel?: string;
}) {
  const r = useMemo(() => parseQuickSession(text), [text]);
  const [meta, setMeta] = useState<ExMeta>(initialMeta ?? {});
  const push = (t: string, m: ExMeta) => {
    const p = parseQuickSession(t);
    // solo se pasa a la planilla lo que se entendió completo; con un error no se puede revisar la sesión hasta corregirlo
    onSegments(applyMeta(p.segments, m), !p.errors.length);
  };
  const change = (t: string) => {
    onText(t);
    push(t, meta);
  };
  const setOne = (ex: string, patch: Partial<ExMeta[string]>) => {
    const m = { ...meta, [ex]: { pause: '', view: '', prog: '', ...meta[ex], ...patch } };
    setMeta(m);
    onMeta?.(m);
    push(text, m);
  };
  const append = (line: string) => change(text ? `${text.replace(/\n+$/, '')}\n${line}` : line);
  const sets = r.lines.reduce((a, l) => a + l.sets, 0);
  return (
    <div className="quick-entry">
      <div className="quick-help">
        <strong>Escribí la sesión, una línea por ejercicio.</strong>
        <span>
          Series×reps con <code>@RPE</code> o <code>RIR</code>. Una serie por RPE: <code>3x5@4-5-6</code>.
          Carga: <code>3x5x100</code>. Varios bloques: <code>+</code>. Prioridad del coach: <code>1°</code> al
          inicio. También podés pegar una tabla de Excel o una lista de WhatsApp.
        </span>
      </div>
      <textarea
        className="quick-text"
        rows={9}
        spellCheck={false}
        disabled={disabled}
        value={text}
        placeholder={
          '1° Squat comp 3x5@4-5-6\n2° Bench tyg 4x7@7\nRemo barra 3x10-12 RIR2\nTricep 3x12-15 @8'
        }
        onChange={(e) => change(e.target.value)}
        aria-label="Sesión en texto"
      />
      <div className="quick-examples">
        <span>Probar:</span>
        {EXAMPLES.map((x) => (
          <button key={x.n} type="button" title={x.t} onClick={() => append(x.t)}>
            {x.n}
          </button>
        ))}
      </div>
      {r.errors.length > 0 && (
        <ul className="quick-errors" role="alert">
          {r.errors.map((e) => (
            <li key={e.line + e.message}>
              <b>Línea {e.line}:</b> {e.message}
            </li>
          ))}
        </ul>
      )}
      {r.lines.length > 0 && (
        <div className="quick-preview">
          <h4>
            Lo que se entendió · {r.lines.length} {r.lines.length === 1 ? 'ejercicio' : 'ejercicios'} · {sets}{' '}
            series
          </h4>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Ejercicio</th>
                <th>Prescripción</th>
                <th>Movimiento</th>
                <th>Prio</th>
                <th title="Descanso entre series de este ejercicio (el atleta ve una cuenta regresiva)">
                  Descanso
                </th>
                <th title="Qué ve el atleta de este ejercicio">El atleta ve</th>
                <th title="La progresión sugerida siempre la ve el coach; acá decidís si el atleta también ve la meta">
                  Meta al atleta
                </th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => {
                const seg = r.segments.find((s) => s.exerciseName === l.exercise);
                return (
                  <tr key={l.line}>
                    <td>{l.line}</td>
                    <td>{l.exercise}</td>
                    <td>
                      {l.summary}
                      {l.warnings.length > 0 && <small> · {l.warnings.join(' · ')}</small>}
                    </td>
                    <td>{movementLabel(seg?.lift ?? '')}</td>
                    <td>{seg?.priority ? `${seg.priority}°` : '—'}</td>
                    <td className="qe-rest">
                      <input
                        type="number"
                        min={0}
                        max={900}
                        step={15}
                        list="qe-rests"
                        placeholder="s"
                        disabled={disabled}
                        value={meta[l.exercise]?.pause ?? ''}
                        onChange={(e) => setOne(l.exercise, { pause: e.target.value })}
                        aria-label={`Descanso de ${l.exercise} en segundos`}
                      />
                    </td>
                    <td>
                      <select
                        disabled={disabled}
                        value={meta[l.exercise]?.view ?? ''}
                        onChange={(e) => setOne(l.exercise, { view: e.target.value })}
                        aria-label={`Qué ve el atleta en ${l.exercise}`}
                      >
                        <option value="">
                          Lo habitual{defaultViewLabel ? ` (${defaultViewLabel})` : ''}
                        </option>
                        {Object.entries(VIEW_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        disabled={disabled}
                        value={meta[l.exercise]?.prog ?? ''}
                        onChange={(e) => setOne(l.exercise, { prog: e.target.value })}
                        aria-label={`Meta de progresión para el atleta en ${l.exercise}`}
                      >
                        <option value="">No (solo coach)</option>
                        <option value="reps">Meta de reps</option>
                        <option value="reps_kg">Reps y kg</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="qe-rests">
            {RESTS.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <p className="small muted">
            Descanso en segundos por ejercicio y qué ve el atleta (por ejemplo, solo RPE en sentadilla y todo
            en banca): se guarda con la sesión y llega al atleta apenas la publicás.
          </p>
          <p className="small muted">
            El movimiento y la prioridad se sugieren por el nombre y por tu «1°/2°». Corregilos en «Planilla
            de segmentos» si hace falta, antes de revisar la sesión.
          </p>
        </div>
      )}
    </div>
  );
}
