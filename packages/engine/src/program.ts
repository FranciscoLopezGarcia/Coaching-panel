import { diffSnapshots, type ChangeEvent } from './diff.js';
import { pctFromTable } from './e1rm.js';
import { floorToStep } from './format.js';
import { blockMetrics } from './metrics.js';
import type { PlanSnapshot } from './snapshot.js';
import type { Lift, PlannedSet, Protocol } from './types.js';
import { toViews } from './views.js';

/**
 * Operaciones de programación sobre series PREVISTAS. Son funciones puras: devuelven los sets nuevos y una vista previa; quien las aplica
 * (API) lo hace como borrador o versión aplicada, de modo que el historial automático registre UN evento por aplicación (no por edición).
 *
 * Garantías:
 *  - Copiar programación NO copia resultados, cuestionarios ni estados de completado (la ejecución vive en otra tabla y no se toca).
 *  - Nunca modifica semanas/sesiones que no estén en la selección explícita. Una selección vacía es un error.
 *  - Nunca sobrescribe en silencio programación existente: si el destino ya tiene series, falla salvo `replaceExisting: true` (y la vista previa lo marca).
 *  - Cada instancia copiada tiene un id NUEVO y determinista; conserva la identidad de exposición y registra su linaje (`copiedFrom`).
 */
export class ProgramError extends Error {}

export interface Selection {
  blockKey?: string;
  weeks?: number[];
  sessionKeys?: string[];
  exposureIds?: string[];
  /** Series concretas (ids estables). */
  setIds?: string[];
  /** Segmentos identificables (`segmentKeyOf`): sesión + exposición + segmento (top/backoff/work). */
  segmentKeys?: string[];
  lift?: Lift;
}

/** Identidad de un segmento: sesión + exposición + segmento del protocolo. Estable mientras no se muevan los ids de sesión/exposición. */
export const segmentKeyOf = (s: PlannedSet): string =>
  `${s.sessionKey}|${s.exposureId}|${s.protocol?.segment ?? 'work'}`;

const hasSelection = (s: Selection): boolean =>
  !!(
    s.blockKey ||
    s.weeks?.length ||
    s.sessionKeys?.length ||
    s.exposureIds?.length ||
    s.setIds?.length ||
    s.segmentKeys?.length ||
    s.lift
  );

export function selectSets(sets: PlannedSet[], sel: Selection): PlannedSet[] {
  if (!hasSelection(sel))
    throw new ProgramError(
      'Hay que indicar una selección explícita de destinos (bloque, semanas, sesiones, exposiciones, series o segmentos).',
    );
  const out = sets.filter(
    (s) =>
      (!sel.blockKey || s.blockKey === sel.blockKey) &&
      (!sel.weeks?.length || sel.weeks.includes(s.weekNo)) &&
      (!sel.sessionKeys?.length || sel.sessionKeys.includes(s.sessionKey)) &&
      (!sel.exposureIds?.length || sel.exposureIds.includes(s.exposureId)) &&
      (!sel.setIds?.length || sel.setIds.includes(s.id)) &&
      (!sel.segmentKeys?.length || sel.segmentKeys.includes(segmentKeyOf(s))) &&
      (!sel.lift || s.lift === sel.lift),
  );
  if (!out.length) throw new ProgramError('La selección no coincide con ninguna serie.');
  return out;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diffDays = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/* ---------------- Protocolos ---------------- */

export interface ResolvedKg {
  kg: number | null;
  source: 'fixed' | 'derived' | null;
  missing: string[];
}

/**
 * Carga prevista de una serie según su protocolo:
 *  - kg: la carga fija; - pct: pct × referencia; - rpe: referencia × %tabla(reps, RPE objetivo); - rpe_cap: lo anterior con tope.
 * Si falta un dato (referencia, RPE, dominio de la tabla) devuelve null con el motivo: NO se estima. Las instrucciones libres no se usan.
 */
export function resolvePlannedKg(s: PlannedSet, stepKg?: number): ResolvedKg {
  const p = s.protocol;
  const round = (x: number) => (stepKg ? floorToStep(x, stepKg) : x);
  if (!p || p.loadMode === 'kg')
    return s.plannedKg !== null
      ? { kg: s.plannedKg, source: 'fixed', missing: [] }
      : { kg: null, source: null, missing: ['carga fija'] };
  if (p.loadMode === 'pct') {
    if (p.pct === null) return { kg: null, source: null, missing: ['porcentaje'] };
    if (!s.refKg) return { kg: null, source: null, missing: ['referencia de fuerza'] };
    return { kg: round((s.refKg * p.pct) / 100), source: 'derived', missing: [] };
  }
  const missing: string[] = [];
  if (!s.refKg) missing.push('referencia de fuerza');
  if (s.targetRpe === null) missing.push('RPE objetivo');
  const pct = s.targetRpe !== null ? pctFromTable(s.reps, s.targetRpe) : null;
  if (s.targetRpe !== null && pct === null)
    missing.push(`dominio de la tabla (${s.reps} reps @ RPE ${s.targetRpe})`);
  if (missing.length) return { kg: null, source: null, missing };
  let kg = round((s.refKg as number) * (pct as number));
  if (p.loadMode === 'rpe_cap') {
    if (p.capKg === null) return { kg: null, source: null, missing: ['tope de carga'] };
    kg = Math.min(kg, p.capKg);
  }
  return { kg, source: 'derived', missing: [] };
}

/** Completa `plannedKg` desde el protocolo cuando es calculable (marcado como 'derived'); nunca pisa una carga fija. */
export function withDerivedLoads(sets: PlannedSet[], stepKg?: number): PlannedSet[] {
  return sets.map((s) => {
    if (!s.protocol || s.protocol.loadMode === 'kg') return s;
    const r = resolvePlannedKg(s, stepKg);
    return r.kg === null
      ? { ...s, plannedKg: null, plannedKgSource: null }
      : { ...s, plannedKg: r.kg, plannedKgSource: 'derived' as const };
  });
}

/* ---------------- Copias ---------------- */

export interface Added {
  added: PlannedSet[];
  /** Series existentes en el destino que se reemplazarían (solo con replaceExisting). */
  overwrites: PlannedSet[];
}

function copySets(
  src: PlannedSet[],
  make: (s: PlannedSet) => Partial<PlannedSet> & { id: string },
): PlannedSet[] {
  return src.map((s) => ({ ...s, ...make(s), copiedFrom: s.id }));
}

function ensureFree(existing: PlannedSet[], created: PlannedSet[], replaceExisting: boolean): PlannedSet[] {
  const ids = new Map(existing.map((s) => [s.id, s]));
  const sameTarget = existing.filter((e) =>
    created.some((c) => c.blockKey === e.blockKey && c.weekNo === e.weekNo && c.sessionKey === e.sessionKey),
  );
  const clash = created.filter((c) => ids.has(c.id));
  const overwrites = [
    ...new Map(
      [...clash.map((c) => ids.get(c.id) as PlannedSet), ...sameTarget].map((s) => [s.id, s]),
    ).values(),
  ];
  if (overwrites.length && !replaceExisting)
    throw new ProgramError(
      `El destino ya tiene ${overwrites.length} serie(s): no se sobrescribe sin una confirmación explícita (replaceExisting).`,
    );
  return overwrites;
}

export function duplicateSession(
  sets: PlannedSet[],
  o: {
    sessionKey: string;
    newSessionKey: string;
    plannedDate: string;
    dayNo?: number;
    weekNo?: number;
    blockKey?: string;
    slotKey?: string;
    replaceExisting?: boolean;
  },
): Added {
  const src = sets.filter((s) => s.sessionKey === o.sessionKey);
  if (!src.length) throw new ProgramError(`No existe la sesión ${o.sessionKey}.`);
  if (sets.some((s) => s.sessionKey === o.newSessionKey) && !o.replaceExisting)
    throw new ProgramError(`Ya existe la sesión ${o.newSessionKey}: se necesita otro identificador.`);
  const added = copySets(src, (s) => ({
    id: `${o.newSessionKey}-${s.setNo}`,
    sessionKey: o.newSessionKey,
    plannedDate: o.plannedDate,
    dayNo: o.dayNo ?? s.dayNo,
    weekNo: o.weekNo ?? s.weekNo,
    blockKey: o.blockKey ?? s.blockKey,
    slotKey: o.slotKey ?? s.slotKey,
  }));
  return { added, overwrites: ensureFree(sets, added, !!o.replaceExisting) };
}

/** Copia una semana de un bloque a otra (por defecto, la siguiente), desplazando las fechas. No copia resultados ni toca la semana original. */
export function repeatWeek(
  sets: PlannedSet[],
  o: {
    blockKey: string;
    sourceWeek: number;
    targetWeek: number;
    shiftDays?: number;
    targetStartDate?: string;
    replaceExisting?: boolean;
  },
): Added {
  const src = sets.filter((s) => s.blockKey === o.blockKey && s.weekNo === o.sourceWeek);
  if (!src.length) throw new ProgramError(`El bloque ${o.blockKey} no tiene la semana ${o.sourceWeek}.`);
  if (o.targetWeek === o.sourceWeek)
    throw new ProgramError('La semana de destino debe ser distinta de la de origen.');
  const first = src.map((s) => s.plannedDate).sort()[0] as string;
  const shift = o.targetStartDate
    ? diffDays(o.targetStartDate, first)
    : (o.shiftDays ?? 7 * (o.targetWeek - o.sourceWeek));
  const added = copySets(src, (s) => ({
    id: `${o.blockKey}-w${o.targetWeek}-${s.sessionKey.replace(new RegExp(`^${o.blockKey}-w${o.sourceWeek}-`), '')}-${s.setNo}`.replace(
      /--+/g,
      '-',
    ),
    sessionKey: `${o.blockKey}-w${o.targetWeek}-${s.sessionKey.replace(new RegExp(`^${o.blockKey}-w${o.sourceWeek}-`), '')}`,
    weekNo: o.targetWeek,
    plannedDate: addDays(s.plannedDate, shift),
  }));
  const sk = new Set(added.map((a) => a.sessionKey));
  if (sk.size !== new Set(src.map((s) => s.sessionKey)).size)
    throw new ProgramError('No se pudieron derivar identificadores únicos de sesión para la copia.');
  const targetExisting = sets.filter((s) => s.blockKey === o.blockKey && s.weekNo === o.targetWeek);
  if (targetExisting.length && !o.replaceExisting)
    throw new ProgramError(
      `La semana ${o.targetWeek} del bloque ${o.blockKey} ya tiene ${targetExisting.length} serie(s): no se sobrescribe sin una confirmación explícita (replaceExisting).`,
    );
  return { added, overwrites: targetExisting };
}

/** Repite la estructura de una semana en semanas EXPLÍCITAS. Nunca toca otras semanas. */
export function repeatStructure(
  sets: PlannedSet[],
  o: { blockKey: string; sourceWeek: number; targetWeeks: number[]; replaceExisting?: boolean },
): Added {
  if (!o.targetWeeks.length) throw new ProgramError('Hay que indicar las semanas de destino.');
  let acc = sets;
  const added: PlannedSet[] = [];
  const overwrites: PlannedSet[] = [];
  for (const w of o.targetWeeks) {
    const r = repeatWeek(acc, {
      blockKey: o.blockKey,
      sourceWeek: o.sourceWeek,
      targetWeek: w,
      replaceExisting: o.replaceExisting,
    });
    added.push(...r.added);
    overwrites.push(...r.overwrites);
    acc = [...acc.filter((s) => !r.overwrites.some((x) => x.id === s.id)), ...r.added];
  }
  return { added, overwrites };
}

/* ---------------- Plantillas ---------------- */

export interface TemplateSet extends Omit<
  PlannedSet,
  'id' | 'sessionKey' | 'plannedDate' | 'blockKey' | 'weekNo' | 'copiedFrom'
> {
  relSession: string;
}
export interface PlanTemplate {
  name: string;
  /** Día relativo (desde el primer día de la semana de origen) de cada sesión. */
  sessions: { relSession: string; offsetDays: number; dayNo: number }[];
  sets: TemplateSet[];
  source: { blockKey: string; weekNo: number };
}

/** Guarda la estructura de UNA semana como plantilla: sin fechas absolutas, sin resultados y sin ids de instancia. */
export function saveTemplate(
  sets: PlannedSet[],
  o: { name: string; blockKey: string; weekNo: number },
): PlanTemplate {
  const src = sets.filter((s) => s.blockKey === o.blockKey && s.weekNo === o.weekNo);
  if (!src.length) throw new ProgramError('No hay series en esa semana para guardar como plantilla.');
  const first = src.map((s) => s.plannedDate).sort()[0] as string;
  const sess = [...new Set(src.map((s) => s.sessionKey))];
  return {
    name: o.name,
    source: { blockKey: o.blockKey, weekNo: o.weekNo },
    sessions: sess.map((k, i) => {
      const s = src.find((x) => x.sessionKey === k) as PlannedSet;
      return { relSession: `s${i + 1}`, offsetDays: diffDays(s.plannedDate, first), dayNo: s.dayNo };
    }),
    sets: src.map((s) => {
      const {
        id: _id,
        sessionKey,
        plannedDate: _pd,
        blockKey: _bk,
        weekNo: _wk,
        copiedFrom: _cf,
        ...rest
      } = s;
      void [_id, _pd, _bk, _wk, _cf];
      return { ...rest, relSession: `s${sess.indexOf(sessionKey) + 1}` };
    }),
  };
}

/** Aplica una plantilla a una semana de destino explícita. Genera ids nuevos y conserva identidad de exposición. */
export function applyTemplate(
  existing: PlannedSet[],
  t: PlanTemplate,
  o: { blockKey: string; weekNo: number; startDate: string; familyKey?: string; replaceExisting?: boolean },
): Added {
  const added: PlannedSet[] = t.sets.map((ts) => {
    const sess = t.sessions.find((x) => x.relSession === ts.relSession) as PlanTemplate['sessions'][number];
    const { relSession, ...rest } = ts;
    const sessionKey = `${o.blockKey}-w${o.weekNo}-${relSession}`;
    return {
      ...rest,
      id: `${sessionKey}-${ts.exposureId}-${ts.setNo}`,
      sessionKey,
      plannedDate: addDays(o.startDate, sess.offsetDays),
      blockKey: o.blockKey,
      weekNo: o.weekNo,
      familyKey: o.familyKey ?? rest.familyKey,
      copiedFrom: null,
    };
  });
  const target = existing.filter((s) => s.blockKey === o.blockKey && s.weekNo === o.weekNo);
  if (target.length && !o.replaceExisting)
    throw new ProgramError(
      `La semana ${o.weekNo} del bloque ${o.blockKey} ya tiene ${target.length} serie(s): no se sobrescribe sin una confirmación explícita (replaceExisting).`,
    );
  return { added, overwrites: target };
}

/* ---------------- Cambio de protocolo en destinos explícitos ---------------- */

export interface ProtocolChange {
  reps?: number;
  targetRpe?: number | null;
  plannedKg?: number | null;
  protocol?: Partial<Protocol> | null;
  variantKey?: string;
  exerciseName?: string;
}

/** Cambia el protocolo SOLO de las series seleccionadas. Devuelve el plan completo con esas series modificadas; el resto queda idéntico. */
export function changeProtocol(
  sets: PlannedSet[],
  sel: Selection,
  change: ProtocolChange,
): { sets: PlannedSet[]; changed: PlannedSet[] } {
  const targets = new Set(selectSets(sets, sel).map((s) => s.id));
  const changed: PlannedSet[] = [];
  const next = sets.map((s) => {
    if (!targets.has(s.id)) return s;
    const proto: Protocol | null =
      change.protocol === undefined
        ? s.protocol
        : change.protocol === null
          ? null
          : {
              loadMode: 'kg',
              pct: null,
              capKg: null,
              segment: 'work',
              tempo: null,
              pauseSec: null,
              instructions: null,
              ...(s.protocol ?? {}),
              ...change.protocol,
            };
    const n: PlannedSet = {
      ...s,
      ...(change.reps !== undefined ? { reps: change.reps } : {}),
      ...(change.targetRpe !== undefined ? { targetRpe: change.targetRpe } : {}),
      ...(change.plannedKg !== undefined
        ? {
            plannedKg: change.plannedKg,
            plannedKgSource: change.plannedKg === null ? null : ('fixed' as const),
          }
        : {}),
      ...(change.variantKey !== undefined ? { variantKey: change.variantKey } : {}),
      ...(change.exerciseName !== undefined ? { exerciseName: change.exerciseName } : {}),
      protocol: proto,
    };
    changed.push(n);
    return n;
  });
  return { sets: next, changed };
}

/* ---------------- Mover una sesión (ubicación ≠ identidad) ---------------- */

/** Cambia la UBICACIÓN de una sesión (fecha/día/posición). Conserva ids y exposureId: la continuidad histórica no se rompe. */
export function moveSession(
  sets: PlannedSet[],
  o: { sessionKey: string; plannedDate: string; dayNo?: number; weekNo?: number; slotKey?: string },
): PlannedSet[] {
  if (!sets.some((s) => s.sessionKey === o.sessionKey))
    throw new ProgramError(`No existe la sesión ${o.sessionKey}.`);
  return sets.map((s) =>
    s.sessionKey === o.sessionKey
      ? {
          ...s,
          plannedDate: o.plannedDate,
          ...(o.dayNo !== undefined ? { dayNo: o.dayNo } : {}),
          ...(o.weekNo !== undefined ? { weekNo: o.weekNo } : {}),
          ...(o.slotKey !== undefined ? { slotKey: o.slotKey } : {}),
        }
      : s,
  );
}

/* ---------------- Vista previa ---------------- */

export interface PlannedAvailability {
  lift: Lift;
  blockKey: string;
  metrics: { id: string; status: 'available' | 'partial' | 'unavailable'; missing: string[] }[];
}

/** Disponibilidad de las métricas PREVISTAS: si falta un dato (carga, referencia, RPE objetivo) se informa parcial y por qué; nada se completa con supuestos. */
export function plannedAvailability(sets: PlannedSet[]): PlannedAvailability[] {
  const views = toViews(sets, [], 'planned', '9999-12-31');
  const out: PlannedAvailability[] = [];
  const keys = new Set(views.map((v) => `${v.lift}|${v.blockKey}`));
  for (const k of [...keys].sort()) {
    const [lift, block] = k.split('|') as [Lift, string];
    const v = views.filter((x) => x.lift === lift && x.blockKey === block);
    const noKg = v.filter((x) => x.kg === null).length;
    const noRef = v.filter((x) => x.kg !== null && !x.refKg).length;
    const noRpe = v.filter((x) => x.rpe === null).length;
    const m = blockMetrics(views, lift, block);
    const st = (bad: number, total: number) =>
      (bad === 0 ? 'available' : bad === total ? 'unavailable' : 'partial') as
        'available' | 'partial' | 'unavailable';
    out.push({
      lift,
      blockKey: block,
      metrics: [
        { id: 'nl', status: m ? 'available' : 'unavailable', missing: [] },
        {
          id: 'tonnage',
          status: st(noKg, v.length),
          missing: noKg
            ? [
                `${noKg} serie(s) sin carga prevista (RPE/porcentaje sin referencia, o sin protocolo calculable)`,
              ]
            : [],
        },
        {
          id: 'intensity_rel',
          status: st(noKg + noRef, v.length),
          missing: noKg + noRef ? [`${noKg + noRef} serie(s) sin carga o sin referencia de fuerza`] : [],
        },
        {
          id: 'si_rts_total',
          status: st(noRpe, v.length),
          missing: noRpe
            ? [`${noRpe} serie(s) sin RPE objetivo: el SI planificado no se completa con supuestos`]
            : [],
        },
      ],
    });
  }
  return out;
}

export interface Preview {
  event: ChangeEvent;
  addedSets: number;
  overwrites: number;
  availability: PlannedAvailability[];
}

/** Vista previa de aplicar un cambio: diferencias clasificadas (como el historial automático) y disponibilidad de métricas previstas. NO guarda nada. */
export function previewChange(
  before: PlannedSet[],
  after: PlannedSet[],
  o: { overwrites?: PlannedSet[]; today?: string } = {},
): Preview {
  const snap = (id: string, sets: PlannedSet[]): PlanSnapshot => ({
    id,
    seq: 0,
    status: 'borrador',
    detectedOn: o.today ?? '9999-12-31',
    effectiveOn: null,
    label: 'vista previa',
    sets,
  });
  return {
    event: diffSnapshots(snap('actual', before), snap('propuesta', after)),
    addedSets: after.filter((s) => !before.some((b) => b.id === s.id)).length,
    overwrites: o.overwrites?.length ?? 0,
    availability: plannedAvailability(after),
  };
}

/** Quita las series seleccionadas del plan vigente. Las que tengan ejecución NO se borran de la historia: el servicio las retira (ver `replace`). */
export function removeSets(
  sets: PlannedSet[],
  sel: Selection,
): { sets: PlannedSet[]; removed: PlannedSet[] } {
  const removed = selectSets(sets, sel);
  const ids = new Set(removed.map((r) => r.id));
  return { sets: sets.filter((x) => !ids.has(x.id)), removed };
}

/** Agrega series nuevas (ids únicos). Nunca pisa una serie existente: un id repetido es un error explícito. */
export function addSets(current: PlannedSet[], incoming: PlannedSet[]): PlannedSet[] {
  const have = new Set(current.map((x) => x.id));
  const dup = incoming.filter((x) => have.has(x.id)).map((x) => x.id);
  if (dup.length)
    throw new ProgramError(
      `Ya existen series con esos ids (no se sobrescribe): ${dup.slice(0, 5).join(', ')}`,
    );
  const seen = new Set<string>();
  for (const x of incoming) {
    if (seen.has(x.id)) throw new ProgramError(`Ids repetidos en las series nuevas: ${x.id}`);
    seen.add(x.id);
  }
  return [...current, ...incoming];
}
