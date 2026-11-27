import { compareAdjacentBlocks, orderedBlocks } from './block-analysis/index.js';
import { shiftIsoDate } from './dates.js';
import type { ChangeEvent } from './diff.js';
import { e1rm, RPE_TABLE_VERSION } from './e1rm.js';
import type { ObservedSet } from './observed.js';
import { slotIndex } from './program.js';
import type { MacroMeta, MesoMeta, MicroMeta } from './queries.js';
import type { ActualSet, CoachReview, Lift, PlannedSet } from './types.js';
import { LIFTS } from './types.js';

/**
 * Exportación de bloques (lo programado contra lo registrado) para debatirlo con otros entrenadores o pasárselo a un modelo.
 * Puro: no lee ni escribe nada. Dato faltante = null (nunca 0). Plan y ejecución van en campos separados y no se completan entre sí.
 * El formato está versionado: es el contrato que puede consumir una integración futura con una IA.
 */
export const BLOCK_EXPORT_VERSION = 'v1';

export interface ExportCheckIn {
  date: string;
  sleep: number | null;
  energy: number | null;
  motivation: number | null;
  stress: number | null;
  pain: number | null;
  readiness: number | null;
  soreness: number | null;
  confidence: number | null;
  sleepHours: number | null;
  bodyweightKg: number | null;
  note: string;
}

export interface BlockExportInput {
  asOf: string;
  generatedAt: string;
  /** Lo pedido. Los bloques salen ordenados por fecha de inicio. */
  selection: ExportSelection[];
  /** Plan conocido al corte, incluidas las series retiradas que tienen ejecución. */
  planned: PlannedSet[];
  /** Series que ya no están en el plan vigente. */
  retiredIds: Set<string>;
  actual: ActualSet[];
  /** Series registradas SIN prescripción (importadas). */
  unplanned: ObservedSet[];
  feedback: { sessionKey: string; endFatigue: number | null; note: string }[];
  exerciseNotes: { sessionKey: string; exerciseName: string; note: string; updatedAt: string }[];
  checkins: ExportCheckIn[];
  reviews: CoachReview[];
  changeEvents: ChangeEvent[];
  mesos: MesoMeta[];
  macros: MacroMeta[];
  micros: MicroMeta[];
  zoneCuts?: number[];
  /** Cierre de bloque que dejó el atleta (uno por bloque), ya con nombres legibles. */
  closings: { blockKey: string; updatedAt: string; answers: unknown }[];
}

export interface ExportSelection {
  blockKey: string;
  /** null = el bloque completo; si no, solo esas semanas. */
  weeks: number[] | null;
}

const diff = (a: number | null, p: number | null) => (a === null || p === null ? null : round(a - p));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const tonnage = (kg: number | null, reps: number | null) =>
  kg === null || reps === null ? null : round(kg * reps);
/** Texto automático de rango de repeticiones: ya viaja estructurado, no es una indicación escrita por el coach. */
const coachText = (s: PlannedSet): string | null => {
  const t = s.protocol?.instructions?.trim() ?? '';
  return t && !/^reps \d+[–-]\d+ \(rango/.test(t) ? t : null;
};

export type ExportStatus = 'hecha' | 'omitida' | 'pendiente' | 'sin_registro';
const STATUS: Record<ActualSet['status'], ExportStatus> = {
  done: 'hecha',
  skipped: 'omitida',
  pending: 'pendiente',
};

function exportSet(s: PlannedSet, a: ActualSet | undefined, retired: boolean) {
  const p = s.protocol;
  const done = a?.status === 'done';
  // Solo lo que el atleta efectivamente hizo cuenta como real: una serie pendiente u omitida no aporta números.
  const real = {
    kg: done ? a.kg : null,
    reps: done ? a.reps : null,
    rpe: done ? a.rpe : null,
  };
  const e =
    real.kg === null || real.reps === null || real.rpe === null ? null : e1rm(real.kg, real.reps, real.rpe);
  return {
    id: s.id,
    serie: s.setNo,
    calentamiento: s.isWarmup,
    enPlanVigente: !retired,
    previsto: {
      reps: s.reps,
      repsMax: p?.repsMax ?? null,
      kg: s.plannedKg,
      origenKg: s.plannedKgSource === 'derived' ? 'calculado' : s.plannedKgSource === 'fixed' ? 'fijo' : null,
      pct: p?.pct ?? null,
      rpe: s.targetRpe,
      referenciaKg: s.refKg,
      modoCarga: p?.loadMode ?? null,
      topeKg: p?.capKg ?? null,
      tramo: p?.segment ?? null,
      tempo: p?.tempo ?? null,
      pausaSeg: p?.pauseSec ?? null,
      tonelaje: tonnage(s.plannedKg, s.reps),
      indicacionCoach: coachText(s),
    },
    real: {
      estado: a ? STATUS[a.status] : ('sin_registro' as const),
      fecha: a?.performedOn ?? null,
      ...real,
      dolor: a?.pain ?? null,
      tonelaje: tonnage(real.kg, real.reps),
      e1rmEstimadoKg: e === null ? null : round(e, 1),
    },
    /** Real menos previsto; null si falta cualquiera de los dos. Con rango de repeticiones se compara contra el piso. */
    diferencia: {
      reps: diff(real.reps, s.reps),
      kg: diff(real.kg, s.plannedKg),
      rpe: diff(real.rpe, s.targetRpe),
    },
  };
}

const groupBy = <T>(xs: T[], key: (x: T) => string): [string, T[]][] => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const g = m.get(k);
    if (g) g.push(x);
    else m.set(k, [x]);
  }
  return [...m.entries()];
};

/** Números del bloque con las mismas funciones que usa el analizador de la app (no se recalcula nada aparte). */
function blockSummary(inp: BlockExportInput, blockKey: string): Record<string, unknown> {
  const byLift: Record<string, unknown> = {};
  let detail: Record<string, unknown> = {};
  for (const lift of ['ALL', ...LIFTS] as (Lift | 'ALL')[]) {
    const sides: Record<string, unknown> = {};
    for (const source of ['planned', 'actual'] as const) {
      const c = compareAdjacentBlocks({
        planned: inp.planned,
        actual: inp.actual,
        currentBlockKey: blockKey,
        asOf: inp.asOf,
        source,
        lift,
        zoneCuts: inp.zoneCuts,
      });
      if (!c) continue;
      const i = c.window.blocks.length - 1;
      sides[source === 'planned' ? 'previsto' : 'real'] = {
        metricas: c.rows.map((r) => ({
          metrica: r.metricId,
          unidad: r.unit,
          valor: r.values[i] ?? null,
          modelo: r.modelFamily,
        })),
        zonasIntensidad: c.zones.byBlock[i] ?? null,
      };
      if (lift === 'ALL' && source === 'actual')
        detail = {
          cumplimiento: c.compliance[i] ?? null,
          cobertura: c.quality[i] ?? null,
          e1rmPorVariante: c.variants.filter((v) => v.blockKey === blockKey),
          cambiosDeEjercicioVsBloqueAnterior: c.changes.filter((x) => x.toBlock === blockKey),
        };
    }
    byLift[lift === 'ALL' ? 'total' : lift] = sides;
  }
  return { porMovimiento: byLift, ...detail };
}

/**
 * Fechas que cubre cada semana elegida: las de su microciclo si están cargadas; si no, 7 días desde su primera sesión,
 * sin pisar el comienzo de la semana siguiente.
 */
function weekRanges(inp: BlockExportInput, blockKey: string, weeks: number[]): [string, string][] {
  const all = inp.planned.filter((s) => s.blockKey === blockKey);
  return weeks.flatMap((n): [string, string][] => {
    const micro = inp.micros.find((m) => m.blockKey === blockKey && m.weekNo === n);
    const dates = all.filter((s) => s.weekNo === n).map((s) => s.plannedDate);
    dates.sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (!first || !last) return [];
    if (micro)
      return [
        [micro.startDate < first ? micro.startDate : first, micro.endDate > last ? micro.endDate : last],
      ];
    const next = all
      .filter((s) => s.weekNo > n && s.plannedDate > last)
      .map((s) => s.plannedDate)
      .sort()[0];
    let end = shiftIsoDate(first, 6);
    if (next && next <= end) end = shiftIsoDate(next, -1);
    return [[first, end > last ? end : last]];
  });
}

function exportBlock(inp: BlockExportInput, blockKey: string, weeks: number[] | null) {
  const blockSets = inp.planned.filter((s) => s.blockKey === blockKey);
  const allWeeks = [...new Set(blockSets.map((s) => s.weekNo))].sort((a, b) => a - b);
  const chosen = weeks ? allWeeks.filter((n) => weeks.includes(n)) : allWeeks;
  const partial = chosen.length < allWeeks.length;
  const sets = blockSets.filter((s) => chosen.includes(s.weekNo));
  // El resumen se calcula solo con las semanas elegidas; los demás bloques quedan igual.
  const scoped = partial
    ? { ...inp, planned: inp.planned.filter((s) => s.blockKey !== blockKey || chosen.includes(s.weekNo)) }
    : inp;
  const meso = inp.mesos.find((m) => m.blockKey === blockKey);
  const macro = inp.macros.find((m) => m.id === meso?.macroId);
  const amap = new Map(
    inp.actual
      .filter((a) => !a.performedOn || a.performedOn <= inp.asOf)
      .map((a) => [a.plannedSetId, a] as const),
  );
  const plannedDates = sets.map((s) => s.plannedDate);
  const performedDates = sets.flatMap((s) => amap.get(s.id)?.performedOn ?? []);
  const ranges = partial ? weekRanges(inp, blockKey, chosen) : [];
  const allDates = [
    ...plannedDates,
    ...performedDates,
    ...(partial ? ranges.flat() : [meso?.startDate, meso?.endDate].filter((d): d is string => !!d)),
  ].sort();
  const from = allDates[0] ?? null;
  const to = allDates[allDates.length - 1] ?? null;
  const done = new Set(performedDates);
  // Con semanas sueltas no entra lo de las semanas intermedias que no se pidieron.
  const inRange = (d: string) =>
    d <= inp.asOf &&
    (partial
      ? done.has(d) || ranges.some(([a, b]) => d >= a && d <= b)
      : from !== null && to !== null && d >= from && d <= to);
  const checkins = inp.checkins.filter((c) => inRange(c.date));
  const checkinOn = new Map(checkins.map((c) => [c.date, c]));

  const sessions = groupBy(sets, (s) => s.sessionKey)
    .map(([sessionKey, ss]) => {
      const first = ss[0] as PlannedSet;
      const performed = [...new Set(ss.flatMap((s) => amap.get(s.id)?.performedOn ?? []))].sort();
      // Cierre y notas no tienen fecha propia fiable: se muestran si la sesión ocurrió (o estaba prevista) hasta el corte.
      const happened = performed.length > 0 || first.plannedDate <= inp.asOf;
      const fb = happened ? inp.feedback.find((f) => f.sessionKey === sessionKey) : undefined;
      const notes = inp.exerciseNotes.filter(
        (n) => n.sessionKey === sessionKey && n.updatedAt.slice(0, 10) <= inp.asOf,
      );
      const exercises = groupBy(
        [...ss].sort((a, b) => slotIndex(a.slotKey) - slotIndex(b.slotKey)),
        (s) => `${s.exposureId}\u0000${s.exerciseName}`,
      ).map(([, es]) => {
        const e = es[0] as PlannedSet;
        return {
          nombre: e.exerciseName,
          variante: e.variantKey,
          movimiento: e.lift,
          grupoMuscular: e.protocol?.muscleGroup ?? null,
          rol: e.exposureRole,
          prioridad: e.priority,
          indicacionesCoach: [...new Set(es.flatMap((s) => coachText(s) ?? []))],
          notaAtleta: notes.find((n) => n.exerciseName === e.exerciseName)?.note ?? null,
          series: [...es]
            .sort((a, b) => a.setNo - b.setNo)
            .map((s) => exportSet(s, amap.get(s.id), inp.retiredIds.has(s.id))),
        };
      });
      const named = new Set(ss.map((s) => s.exerciseName));
      return {
        sesion: sessionKey,
        semana: first.weekNo,
        dia: first.dayNo,
        fechaPrevista: first.plannedDate,
        fechasRealizadas: performed,
        cierreAtleta: fb ? { fatigaFinal: fb.endFatigue, nota: fb.note || null } : null,
        /** Notas de ejercicios que ya no figuran con ese nombre en la sesión (no se pierden). */
        otrasNotasAtleta: notes
          .filter((n) => !named.has(n.exerciseName))
          .map((n) => ({ ejercicio: n.exerciseName, nota: n.note })),
        checkinsDeEsosDias: performed.flatMap((d) => checkinOn.get(d) ?? []),
        ejercicios: exercises,
      };
    })
    .sort(
      (a, b) =>
        a.semana - b.semana ||
        a.dia - b.dia ||
        a.fechaPrevista.localeCompare(b.fechaPrevista) ||
        a.sesion.localeCompare(b.sesion),
    );

  const card = orderedBlocks(inp.planned, inp.asOf).find((b) => b.blockKey === blockKey);
  const summary = card ? blockSummary(scoped, blockKey) : null;
  // Con una parte del bloque, comparar ejercicios contra el bloque anterior daría cambios que no son reales.
  if (summary && partial) delete summary.cambiosDeEjercicioVsBloqueAnterior;
  return {
    bloque: blockKey,
    nombre: meso?.name ?? blockKey,
    objetivo: meso?.objective ?? null,
    macro: macro ? { nombre: macro.name, objetivo: macro.objective } : null,
    desde: from,
    hasta: to,
    alcance: partial ? ('semanas_elegidas' as const) : ('bloque_completo' as const),
    semanasIncluidas: chosen,
    semanasDelBloque: allWeeks.length,
    cerradoAlCorte: card?.closed ?? false,
    /** Calculado sobre lo incluido (todo el bloque o solo las semanas elegidas). */
    resumen: summary,
    sesiones: sessions,
    seriesSinPlan: inp.unplanned
      .filter((o) => inRange(o.date))
      .map((o) => ({
        fecha: o.date,
        fuente: o.source,
        ejercicio: o.exerciseName,
        movimiento: o.lift,
        tipo: o.setType,
        kg: o.kg,
        reps: o.reps,
        rpe: o.rpe,
      })),
    checkins,
    revisionesTecnicasCoach: inp.reviews
      .filter((r) => inRange(r.date))
      .map((r) => ({ fecha: r.date, movimiento: r.lift, veredicto: r.verdict, nota: r.note || null })),
    /** Lo que contestó el atleta al cerrar el bloque (vale para el bloque entero). 1–10; molestias 0–10. */
    cierreDeBloque: (() => {
      const c = inp.closings.find((x) => x.blockKey === blockKey && x.updatedAt.slice(0, 10) <= inp.asOf);
      return c ? { fecha: c.updatedAt.slice(0, 10), respuestas: c.answers } : null;
    })(),
    cambiosDePlan: inp.changeEvents
      .filter((e) => {
        const d = e.effectiveOn ?? e.detectedOn;
        return e.status === 'aplicado' && inRange(d);
      })
      .map((e) => ({
        fecha: e.effectiveOn ?? e.detectedOn,
        cambios: e.changes.map((c) => c.summary),
        comentarioCoach: e.coachComment || null,
      })),
  };
}

export type ExportedBlock = ReturnType<typeof exportBlock>;

export const BLOCK_EXPORT_GUIDE = {
  comoLeerlo: [
    'null significa «sin dato». No es cero ni una serie omitida.',
    '«previsto» es lo que programó el coach; «real» es lo que registró el atleta. Nunca se completan entre sí.',
    'estado: hecha, omitida, pendiente o sin_registro (no se sabe si se hizo).',
    'diferencia = real − previsto. El RPE objetivo no sustituye al RPE real.',
    `e1rmEstimadoKg sale de la curva reps/RPE (${RPE_TABLE_VERSION}) usando el RPE real. Es una estimación, no un máximo medido, y no se transfiere entre variantes.`,
    'RPE de 1 a 10 (10 = sin repeticiones en reserva). Cargas en kg. Dolor, fatiga y check-in en la escala que registró el atleta.',
    'Las métricas del resumen cubren series de trabajo de sentadilla (SQ), banca (BP) y peso muerto (DL) y sus variantes; accesorios y calentamientos figuran en las sesiones pero no entran en esas métricas.',
    'Los índices de estrés (si_*) son una aproximación experimental; no comparar con escalas de otras apps.',
    'Los datos son descriptivos: por sí solos no demuestran causalidad ni permiten diagnosticar lesiones o recuperación.',
  ],
};

export function buildBlockExport(inp: BlockExportInput) {
  const order = new Map(orderedBlocks(inp.planned, inp.asOf).map((b, i) => [b.blockKey, i]));
  const wanted = new Map<string, number[] | null>();
  for (const s of inp.selection) {
    const prev = wanted.get(s.blockKey);
    // El bloque completo manda sobre semanas sueltas del mismo bloque.
    wanted.set(
      s.blockKey,
      prev === null || s.weeks === null ? null : [...new Set([...(prev ?? []), ...s.weeks])],
    );
  }
  const keys = [...wanted.keys()].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
  return {
    formato: 'coaching-bloques',
    version: BLOCK_EXPORT_VERSION,
    generado: inp.generatedAt,
    corte: inp.asOf,
    guia: BLOCK_EXPORT_GUIDE,
    bloques: keys.map((k) => exportBlock(inp, k, wanted.get(k) ?? null)),
  };
}

// ---------- CSV ----------

type Cell = string | number | boolean | null | undefined;

/** Un texto que empieza con = + - @ se abriría como fórmula en una planilla: se antepone un apóstrofo. */
const csvCell = (v: Cell): string => {
  if (v === null || v === undefined) return '';
  let t = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const join = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(' | ') || null;

/**
 * Tabla plana: una fila por serie (con su contexto repetido), pensada para planillas y modelos.
 * Los check-ins van en las filas del día en que se hicieron; los de días sin entreno solo salen en el JSON.
 */
export function blockExportCsv(data: { bloques: ExportedBlock[] }): string {
  const rows: Record<string, Cell>[] = [];
  for (const b of data.bloques) {
    const base = {
      bloque: b.nombre,
      bloque_id: b.bloque,
      bloque_objetivo: b.objetivo,
      macro: b.macro?.nombre,
    };
    for (const s of b.sesiones)
      for (const e of s.ejercicios)
        for (const x of e.series) {
          const p = x.previsto;
          const r = x.real;
          const c = s.checkinsDeEsosDias.find((k) => k.date === r.fecha);
          const review = b.revisionesTecnicasCoach.find(
            (k) => k.fecha === r.fecha && k.movimiento === e.movimiento,
          );
          rows.push({
            ...base,
            origen: 'plan',
            semana: s.semana,
            dia: s.dia,
            sesion_id: s.sesion,
            fecha_prevista: s.fechaPrevista,
            fecha_realizada: r.fecha,
            ejercicio: e.nombre,
            variante: e.variante,
            movimiento: e.movimiento,
            grupo_muscular: e.grupoMuscular,
            rol: e.rol,
            prioridad: e.prioridad,
            serie: x.serie,
            calentamiento: x.calentamiento,
            en_plan_vigente: x.enPlanVigente,
            estado: r.estado,
            reps_previstas: p.reps,
            reps_previstas_max: p.repsMax,
            reps_hechas: r.reps,
            dif_reps: x.diferencia.reps,
            kg_previsto: p.kg,
            origen_kg_previsto: p.origenKg,
            kg_hecho: r.kg,
            dif_kg: x.diferencia.kg,
            rpe_previsto: p.rpe,
            rpe_real: r.rpe,
            dif_rpe: x.diferencia.rpe,
            pct_previsto: p.pct,
            referencia_kg: p.referenciaKg,
            modo_carga: p.modoCarga,
            tope_kg: p.topeKg,
            tramo: p.tramo,
            tempo: p.tempo,
            pausa_seg: p.pausaSeg,
            tonelaje_previsto: p.tonelaje,
            tonelaje_hecho: r.tonelaje,
            e1rm_estimado_kg: r.e1rmEstimadoKg,
            dolor_serie: r.dolor,
            indicacion_coach: p.indicacionCoach,
            nota_atleta_ejercicio: e.notaAtleta,
            fatiga_final_sesion: s.cierreAtleta?.fatigaFinal,
            nota_atleta_sesion: s.cierreAtleta?.nota,
            otras_notas_atleta: join(s.otrasNotasAtleta.map((n) => `${n.ejercicio}: ${n.nota}`)),
            revision_tecnica: review?.veredicto,
            nota_coach_revision: review?.nota,
            checkin_sueno: c?.sleep,
            checkin_energia: c?.energy,
            checkin_ganas: c?.motivation,
            checkin_estres: c?.stress,
            checkin_molestias: c?.pain,
            checkin_disposicion: c?.readiness,
            checkin_dolor_muscular: c?.soreness,
            checkin_confianza: c?.confidence,
            checkin_horas_sueno: c?.sleepHours,
            checkin_peso_corporal_kg: c?.bodyweightKg,
            checkin_nota: c?.note || null,
          });
        }
    for (const o of b.seriesSinPlan)
      rows.push({
        ...base,
        origen: `sin_plan:${o.fuente}`,
        fecha_realizada: o.fecha,
        ejercicio: o.ejercicio,
        movimiento: o.movimiento,
        calentamiento: o.tipo === 'warmup',
        estado: 'hecha',
        reps_hechas: o.reps,
        kg_hecho: o.kg,
        rpe_real: o.rpe,
        tonelaje_hecho: tonnage(o.kg, o.reps),
      });
  }
  const header = CSV_COLUMNS;
  return [header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\r\n');
}

export const CSV_COLUMNS = [
  'bloque',
  'bloque_id',
  'bloque_objetivo',
  'macro',
  'origen',
  'semana',
  'dia',
  'sesion_id',
  'fecha_prevista',
  'fecha_realizada',
  'ejercicio',
  'variante',
  'movimiento',
  'grupo_muscular',
  'rol',
  'prioridad',
  'serie',
  'calentamiento',
  'en_plan_vigente',
  'estado',
  'reps_previstas',
  'reps_previstas_max',
  'reps_hechas',
  'dif_reps',
  'kg_previsto',
  'origen_kg_previsto',
  'kg_hecho',
  'dif_kg',
  'rpe_previsto',
  'rpe_real',
  'dif_rpe',
  'pct_previsto',
  'referencia_kg',
  'modo_carga',
  'tope_kg',
  'tramo',
  'tempo',
  'pausa_seg',
  'tonelaje_previsto',
  'tonelaje_hecho',
  'e1rm_estimado_kg',
  'dolor_serie',
  'indicacion_coach',
  'nota_atleta_ejercicio',
  'fatiga_final_sesion',
  'nota_atleta_sesion',
  'otras_notas_atleta',
  'revision_tecnica',
  'nota_coach_revision',
  'checkin_sueno',
  'checkin_energia',
  'checkin_ganas',
  'checkin_estres',
  'checkin_molestias',
  'checkin_disposicion',
  'checkin_dolor_muscular',
  'checkin_confianza',
  'checkin_horas_sueno',
  'checkin_peso_corporal_kg',
  'checkin_nota',
];
