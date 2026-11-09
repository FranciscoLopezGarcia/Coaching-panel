import {
  HEVY_PARSER_VERSION,
  fingerprintText,
  parseCanonicalPlan,
  parseHevyCsv,
  plannedAvailability,
  previewHevy,
  type HevyOptions,
  type PlannedSet,
} from '@coaching/engine';
import type { HevyImportInput, ImportPreviewResponse, PlanCsvImportInput } from '@coaching/contracts';
import type { ExerciseMapRepo } from '../repositories/revisions.js';
import type { ObservedRepo } from '../repositories/observed.js';
import { UnprocessableError } from './errors.js';
import type { PlanService } from './plan.js';

/**
 * Importaciones con vista previa (dry-run) y confirmación explícita. `apply` solo escribe si el `confirmToken` coincide con la vista previa
 * del MISMO contenido y opciones. Reimportar es idempotente: lo ya existente se ignora. Nunca se deduce prescripción de lo ejecutado ni descanso de lo ausente.
 */
export class ImportService {
  constructor(
    private observed: ObservedRepo,
    private plans: PlanService,
    private timeZone: string,
    private now: () => string,
    private exerciseMap?: ExerciseMapRepo,
  ) {}

  hevy(athleteId: string, input: HevyImportInput): ImportPreviewResponse {
    const opts: HevyOptions = {
      timeZone: input.timeZone ?? this.timeZone,
      // mapeo guardado del atleta; lo enviado en la solicitud tiene prioridad
      exerciseMap: {
        ...(this.exerciseMap?.list(athleteId) ?? {}),
        ...(input.exerciseMap ?? {}),
      } as HevyOptions['exerciseMap'],
    };
    const parsed = parseHevyCsv(input.csv, opts);
    const existing = this.observed.existingKeys(athleteId, 'hevy');
    const preview = previewHevy(parsed, existing, opts);
    if (input.mode === 'dry_run') return { mode: 'dry_run', preview, applied: null };
    if (preview.fatal.length)
      throw new UnprocessableError('El archivo no se puede importar', { fatal: preview.fatal });
    if (!input.confirmToken || input.confirmToken !== preview.token) {
      throw new UnprocessableError(
        'Para aplicar hay que confirmar exactamente lo que se vio en la vista previa: falta o no coincide el confirmToken.',
        { expectedToken: preview.token, new: preview.newRows },
      );
    }
    const fresh = parsed.rows.filter((r) => !existing.has(r.externalKey));
    const applied = this.observed.insertBatch(
      athleteId,
      {
        source: 'hevy',
        kind: 'observaciones',
        parserVersion: HEVY_PARSER_VERSION,
        timeZone: opts.timeZone as string,
        token: preview.token,
        summary: { ...preview, sample: undefined },
      },
      fresh.map(({ line: _l, warnings: _w, workoutTitle: _t, startRaw: _s, ...r }) => r),
      this.now(),
    );
    return { mode: 'apply', preview, applied };
  }

  /** Programación en el CSV canónico (plan-canonical-v1). La aplicación pasa por el versionado (una versión, un evento). */
  planCsv(
    athleteId: string,
    input: PlanCsvImportInput,
    stepKg?: number,
  ): {
    mode: 'dry_run' | 'apply';
    parse: { ok: boolean; errors: unknown[]; warnings: string[]; summary: unknown; availability: unknown };
    token: string;
    applied: unknown;
  } {
    const parsed = parseCanonicalPlan(input.csv, { stepKg });
    const sets: PlannedSet[] = parsed.sets;
    const token = fingerprintText(
      `${parsed.version}|${input.status}|${input.replace}|${sets
        .map((s) => s.id)
        .sort()
        .join(',')}|${fingerprintText(JSON.stringify(sets))}`,
    );
    const out = {
      ok: parsed.ok,
      errors: parsed.errors,
      warnings: parsed.warnings,
      summary: parsed.summary,
      availability: plannedAvailability(sets),
    };
    if (input.mode === 'dry_run') return { mode: 'dry_run', parse: out, token, applied: null };
    if (!parsed.ok)
      throw new UnprocessableError('El plan tiene errores: no se aplica', {
        errors: parsed.errors.slice(0, 20),
      });
    if (input.confirmToken !== token)
      throw new UnprocessableError(
        'Para aplicar hay que confirmar exactamente lo que se vio en la vista previa: falta o no coincide el confirmToken.',
        { expectedToken: token },
      );
    const applied = this.plans.importPlan(
      athleteId,
      {
        sets: sets.map((s) => ({ ...s })),
        status: input.status,
        replace: input.replace,
        effectiveOn: input.effectiveOn,
        label: input.label ?? 'Importación canónica',
      },
      stepKg,
    );
    return { mode: 'apply', parse: out, token, applied };
  }
}
