import { useState } from 'react';
import type { Lift, ParamsInput } from '@coaching/contracts';
import { LIFT_NAMES } from '../labels';

const LIFTS: Lift[] = ['SQ', 'BP', 'DL'];
const num = (s: string | undefined): number | null =>
  s === undefined || s.trim() === '' ? null : Number(s.replace(',', '.'));
const str = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
const ADVANCED = [
  ['windowDays', 'Ventana de análisis · días', 1, undefined, 1],
  ['rpeTolerance', 'Tolerancia de RPE', 0, undefined, 0.1],
  ['minCompliance', 'Cumplimiento mínimo · fracción 0–1', 0, 1, 0.01],
  ['painBlock', 'Umbral de molestia para revisión', 0, 10, 1],
  ['loadMaxSteps', 'Máximo de pasos de carga propuestos', 1, undefined, 1],
  ['prCheckMaxAgeDays', 'Antigüedad del chequeo de oportunidad · días', 0, undefined, 1],
  ['coachReviewValidityDays', 'Vigencia de revisión técnica · días', 1, undefined, 1],
  ['peakIndexMin', 'Umbral PeakIndex · %', 0, 100, 0.1],
  ['volumeStableN', 'Exposiciones estables para ensayo de volumen', 4, undefined, 1],
  ['volumeRecoveryN', 'Cuestionarios para ensayo de volumen', 2, undefined, 1],
  ['trialWeeks', 'Duración del ensayo · semanas', 1, undefined, 1],
  ['fatigueThreshold', 'Umbral de fatiga registrada', 1, 10, 1],
  ['freqDeteriorationN', 'Exposiciones con deterioro para frecuencia', 2, undefined, 1],
  ['stabilityMinWeeks', 'Ventana mínima de estabilidad · semanas', 1, 26, 1],
  ['rpeSensitivity', 'Sensibilidad al RPE', 0, 2, 0.1],
  ['prExtrapolationReps', 'Margen de extrapolación · reps', 0, 10, 1],
  ['prEffortGap', 'Margen de esfuerzo para candidato', 0, 5, 0.1],
  ['familyTolerancePct', 'Tolerancia entre familias · %', 0, 100, 0.1],
  ['nExposures', 'Exposiciones recientes', 2, 8, 1],
  ['prevDays', 'Ventana previa · días', 14, 180, 1],
  ['readinessValidityDays', 'Vigencia de recuperación · días', 1, 30, 1],
  ['loadN', 'Exposiciones para margen de carga', 1, 5, 1],
  ['loadRpeMargin', 'Margen de RPE para progresar', 0, 2, 0.1],
  ['endN', 'Exposiciones para revisar caída', 2, 5, 1],
  ['endStableN', 'Exposiciones para estabilidad', 4, 12, 1],
] as const;

/** Parámetros del atleta. Sin cambio mínimo definido el motor muestra Δ pero no clasifica. Todos los valores por defecto son PROPUESTA. */
export function ParamsEditor({
  params,
  families,
  onSave,
}: {
  params: ParamsInput;
  families: string[];
  onSave: (p: ParamsInput) => void | Promise<void>;
}) {
  const [v, setV] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = { stepKg: str(params.stepKg), prRpe: str(params.prRpe) };
    for (const l of LIFTS) {
      const c = params.perLift?.[l];
      o[`${l}pct`] = str(c?.minChangePct);
      o[`${l}kg`] = str(c?.minChangeKg);
      o[`${l}lim`] = str(c?.loadLimitKg);
      o[`${l}prReps`] = str(c?.prReps);
    }
    for (const f of families) o[`fam:${f}`] = params.families?.[f]?.objective ?? '';
    for (const [k] of ADVANCED) o[k] = str(params[k]);
    return o;
  });
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = { allowSingleMax: !!params.allowSingleMax };
    for (const l of LIFTS) o[`${l}explore`] = !!params.perLift?.[l]?.explorationApproved;
    for (const f of families) o[`gold:${f}`] = !!params.families?.[f]?.goldenConfirmed;
    return o;
  });
  const set = (k: string, x: string) => setV((s) => ({ ...s, [k]: x }));
  const flag = (k: string, x: boolean) => setFlags((s) => ({ ...s, [k]: x }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const perLift: NonNullable<ParamsInput['perLift']> = {};
      for (const l of LIFTS) {
        perLift[l] = {
          ...params.perLift?.[l],
          minChangePct: num(v[`${l}pct`]),
          minChangeKg: num(v[`${l}kg`]),
          loadLimitKg: num(v[`${l}lim`]),
          prReps: num(v[`${l}prReps`]),
          explorationApproved: !!flags[`${l}explore`],
        };
      }
      const fam: NonNullable<ParamsInput['families']> = {};
      for (const f of families)
        fam[f] = {
          ...(v[`fam:${f}`] ? { objective: v[`fam:${f}`] } : {}),
          goldenConfirmed: !!flags[`gold:${f}`],
        };
      const stepKg = num(v.stepKg);
      const prRpe = num(v.prRpe);
      await onSave({
        ...params,
        ...Object.fromEntries(
          ADVANCED.filter(([k]) => v[k] !== undefined && v[k]!.trim() !== '').map(([k]) => [k, Number(v[k])]),
        ),
        ...(stepKg ? { stepKg } : {}),
        ...(prRpe ? { prRpe } : {}),
        allowSingleMax: !!flags.allowSingleMax,
        perLift,
        families: { ...params.families, ...fam },
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="lift">
      <summary>
        <strong>Parámetros del atleta</strong>{' '}
        <span className="muted small">(cambio mínimo, paso, límites y habilitaciones del coach)</span>
      </summary>
      <p className="small muted">
        Sin un cambio mínimo definido el sistema muestra la diferencia pero no clasifica progreso ni caída.
        Con % y kg definidos se exigen ambos. Los demás umbrales son una propuesta operativa versionada y se
        ven en cada evidencia.
      </p>
      <div className="grid-params">
        {LIFTS.map((l) => (
          <fieldset key={l}>
            <legend>{LIFT_NAMES[l]}</legend>
            <label>
              Cambio mín. (%)
              <input
                value={v[`${l}pct`]}
                onChange={(e) => set(`${l}pct`, e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Cambio mín. (kg)
              <input
                value={v[`${l}kg`]}
                onChange={(e) => set(`${l}kg`, e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Límite de carga del coach (kg)
              <input
                value={v[`${l}lim`]}
                onChange={(e) => set(`${l}lim`, e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label>
              Reps del récord a evaluar
              <input
                value={v[`${l}prReps`]}
                onChange={(e) => set(`${l}prReps`, e.target.value)}
                inputMode="numeric"
                placeholder="auto"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={!!flags[`${l}explore`]}
                onChange={(e) => flag(`${l}explore`, e.target.checked)}
              />
              Confirmo un ensayo exploratorio de volumen
            </label>
          </fieldset>
        ))}
        <fieldset>
          <legend>General</legend>
          <label>
            Paso de carga (kg)
            <input
              value={v.stepKg}
              onChange={(e) => set('stepKg', e.target.value)}
              inputMode="decimal"
              placeholder="2,5"
            />
          </label>
          <label>
            RPE objetivo del intento de récord
            <input
              value={v.prRpe}
              onChange={(e) => set('prRpe', e.target.value)}
              inputMode="decimal"
              placeholder="9"
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!flags.allowSingleMax}
              onChange={(e) => flag('allowSingleMax', e.target.checked)}
            />
            Habilitar propuestas de single máximo (apagado por defecto)
          </label>
        </fieldset>
        {families.map((f) => (
          <fieldset key={f}>
            <legend>Familia {f}</legend>
            <label>
              Objetivo
              <input
                value={v[`fam:${f}`]}
                onChange={(e) => set(`fam:${f}`, e.target.value)}
                placeholder="fuerza, hipertrofia, técnica…"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={!!flags[`gold:${f}`]}
                onChange={(e) => flag(`gold:${f}`, e.target.checked)}
              />
              Confirmo el contexto como «golden»
            </label>
          </fieldset>
        ))}
      </div>
      <details>
        <summary>Parámetros avanzados del motor</summary>
        <p className="small muted">
          Alcance: atleta. Cada ajuste cambia las condiciones de lectura o propuesta, no modifica series ni
          resultados. Vacío conserva el valor vigente o el default del backend. Método y versiones se
          consultan en la evidencia después de re-evaluar. La API es la autoridad sobre rangos y
          compatibilidad.
        </p>
        <div className="form-grid">
          {ADVANCED.map(([k, label, min, max, step]) => (
            <label key={k}>
              {label}
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={v[k] ?? ''}
                onChange={(e) => set(k, e.target.value)}
              />
            </label>
          ))}
        </div>
      </details>
      <button disabled={busy} onClick={save}>
        Guardar parámetros
      </button>
    </details>
  );
}
