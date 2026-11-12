import {
  diffSnapshots,
  plansEqual,
  withDerivedLoads,
  type ChangeEvent,
  type PlanSnapshot,
  type PlannedSet,
} from '@coaching/engine';
import type { ImportPlanInput } from '@coaching/contracts';
import type { Db } from '../db/connection.js';
import type { HistoryRepo } from '../repositories/history.js';
import type { RecordsRepo } from '../repositories/records.js';
import { UnprocessableError } from './errors.js';

type Incoming = ImportPlanInput['sets'][number];

const isoWeekday = (iso: string): number => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // lunes = 1
const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Completa los campos opcionales de forma DETERMINISTA (importar dos veces lo mismo da exactamente lo mismo). La identidad se declara o se deriva del nombre (y se marca). */
export function normalizePlan(
  incoming: Incoming[],
  current: PlannedSet[],
  stepKg?: number,
): { sets: PlannedSet[]; derivedIdentity: string[] } {
  const cur = new Map(current.map((s) => [s.id, s]));
  const earliest = [
    ...incoming.map((s) => s.plannedDate),
    ...current.map((s) => s.plannedDate),
  ].sort()[0] as string;
  const derived = new Set<string>();
  const sets = incoming.map((s): PlannedSet => {
    const prev = cur.get(s.id);
    const blockKey = s.blockKey ?? prev?.blockKey ?? 'B1';
    const exposureId =
      s.exposureId ?? prev?.exposureId ?? (derived.add(slug(s.exerciseName)), slug(s.exerciseName));
    return {
      id: s.id,
      sessionKey: s.sessionKey,
      slotKey: s.slotKey,
      exerciseName: s.exerciseName,
      lift: s.lift,
      plannedDate: s.plannedDate,
      setNo: s.setNo,
      reps: s.reps,
      targetRpe: s.targetRpe,
      plannedKg: s.plannedKg,
      plannedKgSource:
        s.plannedKg !== null
          ? prev?.plannedKgSource === 'derived' && prev.plannedKg === s.plannedKg
            ? 'derived'
            : 'fixed'
          : null,
      protocol:
        s.protocol === undefined
          ? (prev?.protocol ?? null)
          : s.protocol
            ? {
                loadMode: s.protocol.loadMode,
                pct: s.protocol.pct ?? null,
                capKg: s.protocol.capKg ?? null,
                segment: s.protocol.segment ?? 'work',
                tempo: s.protocol.tempo ?? null,
                pauseSec: s.protocol.pauseSec ?? null,
                instructions: s.protocol.instructions ?? null,
                repsMax: s.protocol.repsMax ?? null,
                athleteView: s.protocol.athleteView ?? null,
                athleteProgression: s.protocol.athleteProgression ?? null,
                muscleGroup: s.protocol.muscleGroup ?? null,
              }
            : null,
      isWarmup: s.isWarmup ?? false,
      blockKey,
      weekNo: s.weekNo ?? prev?.weekNo ?? Math.floor(dayDiff(s.plannedDate, earliest) / 7) + 1,
      dayNo: s.dayNo ?? prev?.dayNo ?? isoWeekday(s.plannedDate),
      familyKey: s.familyKey ?? prev?.familyKey ?? blockKey,
      refKg: s.refKg === undefined ? (prev?.refKg ?? null) : s.refKg,
      exposureId,
      exposureRole: s.exposureRole === undefined ? (prev?.exposureRole ?? null) : s.exposureRole,
      priority: s.priority === undefined ? (prev?.priority ?? null) : s.priority,
      variantKey: s.variantKey ?? prev?.variantKey ?? s.exerciseName,
      copiedFrom: s.copiedFrom === undefined ? (prev?.copiedFrom ?? null) : s.copiedFrom,
    };
  });
  // carga prevista derivada del protocolo: solo para series SIN carga y CON protocolo calculable; nunca pisa una carga fija ni inventa datos
  const withLoads = sets.map((x) =>
    x.plannedKg === null && x.protocol ? (withDerivedLoads([x], stepKg)[0] as PlannedSet) : x,
  );
  return { sets: withLoads, derivedIdentity: [...derived] };
}

export interface ImportResult {
  changed: boolean;
  status: 'aplicado' | 'borrador';
  version: { id: string; seq: number } | null;
  event: ChangeEvent | null;
  note: string;
  retired: number;
  deleted: number;
  warnings: string[];
}

/**
 * Versionado del plan. Cada guardado APLICADO que cambia el contenido genera una versión y UN evento compuesto (diff contra la versión previa).
 * Guardar lo mismo, reordenar filas con IDs estables o reimportar no crea versiones ni eventos. Los borradores no tocan el plan vigente ni generan eventos.
 */
export class PlanService {
  constructor(
    private db: Db,
    private records: RecordsRepo,
    private history: HistoryRepo,
    private today: () => string,
  ) {}

  /** Estado resultante de aplicar `input` sobre el plan vigente (sin guardar nada). Sirve para vistas previas. */
  async resolve(
    athleteId: string,
    input: ImportPlanInput,
    stepKg?: number,
  ): Promise<{ current: PlannedSet[]; next: PlannedSet[]; derivedIdentity: string[] }> {
    const seen = new Set<string>();
    const dup = input.sets.filter((s) => (seen.has(s.id) ? true : (seen.add(s.id), false))).map((s) => s.id);
    if (dup.length)
      throw new UnprocessableError(
        'Hay series con el mismo id en el plan: cada serie necesita un id único y estable',
        { duplicates: [...new Set(dup)].slice(0, 10) },
      );
    const current = await this.records.listActivePlanned(athleteId);
    const { sets: incoming, derivedIdentity } = normalizePlan(input.sets, current, stepKg);
    const merged = new Map(current.map((s) => [s.id, s]));
    for (const s of incoming) merged.set(s.id, s);
    return { current, next: input.replace ? incoming : [...merged.values()], derivedIdentity };
  }

  async importPlan(athleteId: string, input: ImportPlanInput, stepKg?: number): Promise<ImportResult> {
    const { next, derivedIdentity } = await this.resolve(athleteId, input, stepKg);
    const lastApplied = await this.history.latestApplied(athleteId);
    const warnings = derivedIdentity.length
      ? [
          `${derivedIdentity.length} ejercicio(s) sin exposureId: la identidad se derivó del nombre (${derivedIdentity.slice(0, 5).join(', ')}).`,
        ]
      : [];
    const base: ImportResult = {
      changed: false,
      status: input.status,
      version: null,
      event: null,
      note: '',
      retired: 0,
      deleted: 0,
      warnings,
    };
    const source = derivedIdentity.length ? ('derivada_del_nombre' as const) : ('declarada' as const);

    if (input.status === 'borrador') {
      const draft = await this.history.latestDraft(athleteId);
      if (lastApplied && plansEqual(lastApplied.sets, next))
        return { ...base, note: 'El borrador es igual a la versión aplicada: no se guarda.' };
      if (draft && plansEqual(draft.sets, next))
        return { ...base, version: { id: draft.id, seq: draft.seq }, note: 'El borrador no cambió.' };
      const v = await this.db.transaction(async () => {
        await this.history.dropDrafts(athleteId);
        return await this.history.addVersion(athleteId, {
          status: 'borrador',
          detectedOn: this.today(),
          effectiveOn: input.effectiveOn ?? null,
          label: input.label ?? '',
          sets: next,
        });
      });
      return {
        ...base,
        changed: true,
        version: { id: v.id, seq: v.seq },
        note: 'Borrador guardado: no modifica el plan vigente ni genera eventos hasta que se aplique.',
      };
    }

    if (lastApplied && plansEqual(lastApplied.sets, next))
      return {
        ...base,
        version: { id: lastApplied.id, seq: lastApplied.seq },
        note: 'Sin cambios respecto de la versión aplicada.',
      };
    return await this.db.transaction(async () => {
      this.records.upsertPlanned(athleteId, next, source);
      const gone = input.replace
        ? await this.records.retireMissing(athleteId, new Set(next.map((s) => s.id)))
        : { retired: 0, deleted: 0 };
      await this.history.dropDrafts(athleteId);
      const v: PlanSnapshot = await this.history.addVersion(athleteId, {
        status: 'aplicado',
        detectedOn: this.today(),
        effectiveOn: input.effectiveOn ?? null,
        label: input.label ?? '',
        sets: next,
      });
      let event: ChangeEvent | null = null;
      if (lastApplied) {
        const e = diffSnapshots(lastApplied, v);
        if (e.changes.length || e.setChanges.added || e.setChanges.removed || e.setChanges.modified) {
          await this.history.saveEvent(athleteId, e);
          event = e;
        }
      }
      return {
        ...base,
        changed: true,
        version: { id: v.id, seq: v.seq },
        event,
        retired: gone.retired,
        deleted: gone.deleted,
        note: lastApplied
          ? event
            ? 'Versión nueva con cambios detectados.'
            : 'Versión nueva sin cambios relevantes.'
          : 'Primera versión: no hay versión previa con la que comparar (historial incompleto).',
      };
    });
  }
}
