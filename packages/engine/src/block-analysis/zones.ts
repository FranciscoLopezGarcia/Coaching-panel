import type { Lift } from '../types.js';
import type { SetView } from '../views.js';

/**
 * Distribución de la intensidad por ZONAS de %1RM (descriptiva).
 * Los cortes los define el coach (por defecto 75 y 90: < 75 · 75–90 · ≥ 90, convención del proyecto, editable). Los nombres son
 * «Zona 1, 2, 3…», sin juicio de valor: el sistema NO afirma que una distribución sea mejor que otra (el modelo «polarizado» de Seiler
 * nació en deportes de resistencia y se define por lactato, no por %1RM; no hay respaldo para trasladarlo a la fuerza).
 * Las series sin referencia fechada o sin kg no entran a ninguna zona: se informan aparte (faltante ≠ cero).
 */
export const DEFAULT_ZONE_CUTS = [75, 90];

export interface ZoneRow {
  zone: number;
  label: string;
  /** Rango en %1RM, p. ej. «75–<90». */
  range: string;
  sets: number;
  reps: number;
  /** Fracción sobre las series CON referencia (null si no hay ninguna). */
  shareSets: number | null;
  shareReps: number | null;
}
export interface BlockZones {
  blockKey: string;
  withRef: number;
  withoutRef: number;
  zones: ZoneRow[];
}
export interface IntensityZones {
  cuts: number[];
  byBlock: BlockZones[];
  note: string;
}

export function sanitizeCuts(cuts: number[] | undefined): number[] {
  const c = [...new Set((cuts ?? []).filter((x) => Number.isFinite(x) && x > 0 && x <= 150))].sort(
    (a, b) => a - b,
  );
  return c.length ? c.slice(0, 5) : DEFAULT_ZONE_CUTS;
}

const rangeOf = (cuts: number[], i: number): string =>
  i === 0 ? `<${cuts[0]}` : i === cuts.length ? `≥${cuts[i - 1]}` : `${cuts[i - 1]}–<${cuts[i]}`;

export function intensityZones(
  views: SetView[],
  blockKeys: string[],
  lift: Lift | 'ALL',
  cutsIn?: number[],
): IntensityZones {
  const cuts = sanitizeCuts(cutsIn);
  const byBlock = blockKeys.map((bk): BlockZones => {
    const v = views.filter((x) => x.blockKey === bk && (lift === 'ALL' || x.lift === lift));
    const zs = Array.from({ length: cuts.length + 1 }, (_, i) => ({ sets: 0, reps: 0, i }));
    let withRef = 0;
    for (const x of v) {
      if (x.kg === null || !x.refKg) continue;
      const pct = (100 * x.kg) / x.refKg;
      let z = cuts.findIndex((c) => pct < c);
      if (z < 0) z = cuts.length;
      zs[z]!.sets += 1;
      zs[z]!.reps += x.reps;
      withRef++;
    }
    const reps = zs.reduce((a, z) => a + z.reps, 0);
    return {
      blockKey: bk,
      withRef,
      withoutRef: v.length - withRef,
      zones: zs.map((z) => ({
        zone: z.i + 1,
        label: `Zona ${z.i + 1}`,
        range: rangeOf(cuts, z.i),
        sets: z.sets,
        reps: z.reps,
        shareSets: withRef ? z.sets / withRef : null,
        shareReps: reps ? z.reps / reps : null,
      })),
    };
  });
  return {
    cuts,
    byBlock,
    note: 'Descriptivo: reparte las series con referencia fechada según %1RM. No indica que una distribución sea mejor o peor.',
  };
}
