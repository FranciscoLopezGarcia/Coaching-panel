import { buildParams, type ParamOverrides } from '../src/params.js';
import type { ActualSet, Lift, PlannedSet } from '../src/types.js';

export interface SetSpec {
  reps: number;
  kg: number | null;
  rpe: number | null;
  target?: number | null;
  plannedKg?: number | null;
  status?: ActualSet['status'];
  pain?: number | null;
  noDate?: boolean;
}

export class Fixture {
  planned: PlannedSet[] = [];
  actual: ActualSet[] = [];
  private n = 0;

  /** Una exposición (sesión) con sus series. `date` es la fecha real de ejecución y también la prevista. */
  session(
    date: string,
    sets: SetSpec[],
    o: {
      slot?: string;
      exercise?: string;
      lift?: Lift;
      key?: string;
      plannedDate?: string;
      block?: string;
      exposure?: string;
      variant?: string;
      week?: number;
      day?: number;
      family?: string;
      refKg?: number | null;
    } = {},
  ): this {
    const key = o.key ?? `s${++this.n}`;
    sets.forEach((s, i) => {
      const id = `${key}-${i + 1}`;
      this.planned.push({
        id,
        sessionKey: key,
        slotKey: o.slot ?? 'squat-comp|D1',
        exposureId: o.exposure ?? o.slot ?? 'squat-comp|D1',
        exposureRole: null,
        priority: null,
        variantKey: o.variant ?? o.exercise ?? 'Squat comp',
        copiedFrom: null,
        plannedKgSource: s.plannedKg ? 'fixed' : null,
        protocol: null,
        exerciseName: o.exercise ?? 'Squat comp',
        lift: o.lift ?? 'SQ',
        plannedDate: o.plannedDate ?? date,
        setNo: i + 1,
        reps: s.reps,
        targetRpe: s.target === undefined ? 8 : s.target,
        plannedKg: s.plannedKg ?? null,
        isWarmup: false,
        blockKey: o.block ?? 'B1',
        weekNo: o.week ?? 1,
        dayNo: o.day ?? 1,
        familyKey: o.family ?? 'F1',
        refKg: o.refKg ?? null,
      });
      if (s.status !== 'pending') {
        this.actual.push({
          plannedSetId: id,
          status: s.status ?? 'done',
          kg: s.kg,
          reps: s.status === 'skipped' ? null : s.reps,
          rpe: s.rpe,
          performedOn: s.noDate || s.status === 'skipped' ? null : date,
          pain: s.pain ?? null,
        });
      }
    });
    return this;
  }
  /** Sesión solo prevista (sin ejecutar). */
  future(date: string, sets: Omit<SetSpec, 'rpe'>[], o: Parameters<Fixture['session']>[2] = {}): this {
    return this.session(
      date,
      sets.map((s) => ({ ...s, rpe: null, status: 'pending' as const })),
      o,
    );
  }
}

/** Parámetros con cambio mínimo definido (1,5 % y 2,5 kg) salvo que se indique otra cosa. */
export const withMin = (o: ParamOverrides = {}) =>
  buildParams({
    ...o,
    perLift: { SQ: { minChangePct: 1.5, minChangeKg: 2.5 }, BP: {}, DL: {}, ...(o.perLift ?? {}) },
  });

import type { PlanSnapshot } from '../src/snapshot.js';
export const row = (kg: number, rpe = 8, target = 8, reps = 5, n = 3): SetSpec[] =>
  Array.from({ length: n }, () => ({ reps, kg, rpe, target }));

export function snapshot(
  id: string,
  seq: number,
  fx: Fixture,
  o: { effectiveOn?: string | null; status?: PlanSnapshot['status'] } = {},
): PlanSnapshot {
  return {
    id,
    seq,
    status: o.status ?? 'aplicado',
    detectedOn: '2026-03-01',
    effectiveOn: o.effectiveOn ?? null,
    label: '',
    sets: fx.planned,
  };
}
