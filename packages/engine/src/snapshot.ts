import type { PlannedSet } from './types.js';

/** Versión de la programación: foto del plan en el momento de guardarlo/aplicarlo. Los borradores no generan eventos. */
export interface PlanSnapshot {
  id: string;
  seq: number;
  status: 'aplicado' | 'borrador';
  /** Cuándo el sistema DETECTÓ la versión (no cuándo la editó el coach, que no se observa). */
  detectedOn: string;
  /** Desde cuándo rige (fecha efectiva). Si no se informó, se estima desde la primera serie que cambió. */
  effectiveOn: string | null;
  label: string;
  sets: PlannedSet[];
}

const KEYS: (keyof PlannedSet)[] = [
  'id',
  'sessionKey',
  'slotKey',
  'exposureId',
  'exposureRole',
  'priority',
  'variantKey',
  'copiedFrom',
  'plannedKgSource',
  'protocol',
  'exerciseName',
  'lift',
  'plannedDate',
  'setNo',
  'reps',
  'targetRpe',
  'plannedKg',
  'isWarmup',
  'blockKey',
  'weekNo',
  'dayNo',
  'familyKey',
  'refKg',
];

/** Representación canónica (ordenada por id, claves en orden fijo): reordenar filas con IDs estables no cambia nada. */
export function canonicalPlan(sets: PlannedSet[]): string {
  return JSON.stringify(
    [...sets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((s) => KEYS.map((k) => s[k])),
  );
}
export const plansEqual = (a: PlannedSet[], b: PlannedSet[]): boolean =>
  canonicalPlan(a) === canonicalPlan(b);

/** Hash corto de 53 bits (cyrb53) solo para mostrar; la igualdad se decide por contenido. */
export function fingerprint(sets: PlannedSet[]): string {
  const str = canonicalPlan(sets);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}
