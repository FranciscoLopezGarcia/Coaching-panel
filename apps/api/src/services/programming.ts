import {
  addSets,
  applyBlockTemplate,
  applyTemplate,
  removeSets,
  resolvePlannedKg,
  segmentKeyOf,
  changeProtocol,
  duplicateSession,
  moveSession,
  previewChange,
  ProgramError,
  repeatStructure,
  repeatWeek,
  saveBlockTemplate,
  saveTemplate,
  type PlannedSet,
  type Preview,
} from '@coaching/engine';
import type { ProgramOpFullInput } from '@coaching/contracts';
import type { ProgrammingRepo } from '../repositories/programming.js';
import type { RecordsRepo } from '../repositories/records.js';
import { ConflictError, NotFoundError, UnprocessableError } from './errors.js';
import { normalizePlan, type ImportResult, type PlanService } from './plan.js';
import type { HistoryRepo } from '../repositories/history.js';

export interface ProgramResult {
  mode: 'preview' | 'draft' | 'apply';
  /** Versión aplicada sobre la que se calculó. Reenviarla como `baseVersionId` al aplicar detecta cambios concurrentes. */
  baseVersionId: string | null;
  warnings: string[];
  preview: Preview;
  /** Solo en draft/apply. */
  saved: ImportResult | null;
}

/**
 * Operaciones de programación sobre el plan VIGENTE. `preview` no guarda; `draft` guarda un borrador (sin eventos); `apply` aplica como UNA versión
 * y genera UN evento compuesto. Un error de programación (selección vacía, destino ocupado) es un 422 explícito: nada se sobrescribe en silencio.
 */
export class ProgrammingService {
  constructor(
    private records: RecordsRepo,
    private programming: ProgrammingRepo,
    private plans: PlanService,
    private nowIso: () => string,
    private history?: HistoryRepo,
  ) {}

  async baseVersion(athleteId: string): Promise<string | null> {
    return (await this.history?.latestApplied(athleteId))?.id ?? null;
  }

  async run(athleteId: string, input: ProgramOpFullInput, stepKg?: number): Promise<ProgramResult> {
    const base = await this.baseVersion(athleteId);
    if (input.mode !== 'preview' && input.baseVersionId !== undefined && input.baseVersionId !== base)
      throw new ConflictError(
        'El plan cambió desde la vista previa: volvé a calcularla (no se sobrescribe nada).',
        { expectedBaseVersionId: base, received: input.baseVersionId },
      );
    const warnings: string[] = [];
    const current = await this.records.listActivePlanned(athleteId);
    let after: PlannedSet[];
    let overwrites: PlannedSet[] = [];
    try {
      const op = input.op;
      switch (op.type) {
        case 'duplicate_session': {
          const r = duplicateSession(current, op);
          overwrites = r.overwrites;
          after = [...current.filter((s) => !r.overwrites.some((o) => o.id === s.id)), ...r.added];
          break;
        }
        case 'repeat_week': {
          const r = repeatWeek(current, op);
          overwrites = r.overwrites;
          after = [...current.filter((s) => !r.overwrites.some((o) => o.id === s.id)), ...r.added];
          break;
        }
        case 'repeat_structure': {
          const r = repeatStructure(current, op);
          overwrites = r.overwrites;
          after = [...current.filter((s) => !r.overwrites.some((o) => o.id === s.id)), ...r.added];
          break;
        }
        case 'apply_template': {
          const t = await this.programming.getTemplate(athleteId, op.templateId);
          if (!t) throw new NotFoundError('Plantilla inexistente');
          if ('kind' in t)
            throw new ProgramError(
              'Esa plantilla es de un bloque entero: usá «Aplicar plantilla de bloque».',
            );
          const r = applyTemplate(current, t, op);
          overwrites = r.overwrites;
          after = [...current.filter((s) => !r.overwrites.some((o) => o.id === s.id)), ...r.added];
          break;
        }
        case 'apply_block_template': {
          const t = await this.programming.getTemplate(athleteId, op.templateId);
          if (!t) throw new NotFoundError('Plantilla inexistente');
          if (!('kind' in t))
            throw new ProgramError('Esa plantilla es de una semana: usá «Aplicar plantilla».');
          const r = applyBlockTemplate(current, t, op);
          overwrites = r.overwrites;
          after = [...current.filter((s) => !r.overwrites.some((o) => o.id === s.id)), ...r.added];
          break;
        }
        case 'change_protocol':
          after = changeProtocol(current, op.selection, op.change as never).sets;
          break;
        case 'move_session':
          after = moveSession(current, op);
          break;
        case 'remove_sets': {
          const r = removeSets(current, op.selection);
          after = r.sets;
          const done = new Set(
            (await this.records.listActual(athleteId))
              .filter((a) => a.status === 'done')
              .map((a) => a.plannedSetId),
          );
          const withExec = r.removed.filter((x) => done.has(x.id)).length;
          if (withExec)
            warnings.push(
              `${withExec} serie(s) tienen ejecución: se retiran de la programación vigente pero su ejecución y su historia se conservan.`,
            );
          break;
        }
        case 'add_sets': {
          const { sets: fresh } = normalizePlan(op.sets as never, [], stepKg);
          after = addSets(current, fresh);
          break;
        }
      }
    } catch (e) {
      if (e instanceof ProgramError) throw new UnprocessableError(e.message);
      throw e;
    }
    const preview = previewChange(current, after, { overwrites });
    if (input.mode === 'preview')
      return { mode: 'preview', baseVersionId: base, warnings, preview, saved: null };
    const saved = await this.plans.importPlan(
      athleteId,
      {
        sets: after as never,
        status: input.mode === 'apply' ? 'aplicado' : 'borrador',
        replace: true,
        effectiveOn: input.effectiveOn,
        label: input.label,
      },
      stepKg,
    );
    return { mode: input.mode, baseVersionId: base, warnings, preview, saved };
  }

  /** Lectura íntegra de la programación vigente: toda la prescripción con ids estables, protocolo resuelto y ejecución vinculada. */
  async readPlan(athleteId: string, f: PlanReadFilter, stepKg?: number) {
    const done = new Map((await this.records.listActual(athleteId)).map((a) => [a.plannedSetId, a]));
    const sets = (await this.records.listActivePlanned(athleteId)).filter(
      (x) =>
        (!f.sessionKey || x.sessionKey === f.sessionKey) &&
        (!f.blockKey || x.blockKey === f.blockKey) &&
        (!f.weekNo || x.weekNo === f.weekNo) &&
        (!f.exposureId || x.exposureId === f.exposureId) &&
        (!f.from || x.plannedDate >= f.from) &&
        (!f.to || x.plannedDate <= f.to),
    );
    return {
      baseVersionId: await this.baseVersion(athleteId),
      count: sets.length,
      sets: sets.map((x) => ({
        ...x,
        segmentKey: segmentKeyOf(x),
        resolved: resolvePlannedKg(x, stepKg),
        actual: f.includeActual === false ? undefined : (done.get(x.id) ?? null),
      })),
    };
  }

  /** Foto completa de una versión del plan (aplicada o borrador): permite reabrir un borrador y ver el historial de publicación. */
  async version(athleteId: string, versionId: string) {
    const v = ((await this.history?.listVersions(athleteId)) ?? []).find((x) => x.id === versionId);
    if (!v) throw new NotFoundError('Versión inexistente');
    return {
      id: v.id,
      seq: v.seq,
      status: v.status,
      detectedOn: v.detectedOn,
      effectiveOn: v.effectiveOn,
      label: v.label,
      count: v.sets.length,
      sets: v.sets.map((x) => ({ ...x, segmentKey: segmentKeyOf(x) })),
    };
  }

  async saveBlockTemplate(athleteId: string, o: { name: string; blockKey: string }): Promise<{ id: string }> {
    try {
      return {
        id: await this.programming.saveTemplate(
          athleteId,
          saveBlockTemplate(await this.records.listActivePlannedByBlock(athleteId, o.blockKey), o),
          this.nowIso(),
        ),
      };
    } catch (e) {
      if (e instanceof ProgramError) throw new UnprocessableError(e.message);
      throw e;
    }
  }

  async saveTemplate(
    athleteId: string,
    o: { name: string; blockKey: string; weekNo: number },
  ): Promise<{ id: string }> {
    try {
      return {
        id: await this.programming.saveTemplate(
          athleteId,
          saveTemplate(await this.records.listActivePlannedByBlock(athleteId, o.blockKey), o),
          this.nowIso(),
        ),
      };
    } catch (e) {
      if (e instanceof ProgramError) throw new UnprocessableError(e.message);
      throw e;
    }
  }
}

export interface PlanReadFilter {
  sessionKey?: string;
  blockKey?: string;
  weekNo?: number;
  exposureId?: string;
  from?: string;
  to?: string;
  includeActual?: boolean;
}
