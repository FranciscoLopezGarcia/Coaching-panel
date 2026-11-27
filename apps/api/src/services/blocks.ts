import type { Db } from '../db/connection.js';
import type { PlanService } from './plan.js';
import type { RecordsRepo } from '../repositories/records.js';
import type { ProgrammingRepo } from '../repositories/programming.js';
import { ConflictError, NotFoundError } from './errors.js';

export interface RemovalPreview {
  blockKey: string;
  name: string;
  sessions: number;
  sets: number;
  /** Series con ejecución registrada (lo que hizo el atleta). */
  executedSets: number;
  /** El atleta dejó su cierre del bloque (también se borra). */
  hasFeedback: boolean;
}

/**
 * Eliminar un bloque: sale del plan (queda una versión del plan que lo explica) y se borran sus series, su ficha y sus microciclos.
 * Si el atleta ya registró entrenos en el bloque, hay que confirmarlo (`withExecution`): se borra también lo registrado. Irreversible.
 */
export class BlockAdmin {
  constructor(
    private db: Db,
    private records: RecordsRepo,
    private programming: ProgrammingRepo,
    private plans: PlanService,
  ) {}

  async preview(athleteId: string, blockKey: string): Promise<RemovalPreview> {
    const active = (await this.records.listActivePlanned(athleteId)).filter((s) => s.blockKey === blockKey);
    const meso = (await this.programming.listMesos(athleteId)).find((m) => m.blockKey === blockKey);
    if (!active.length && !meso) throw new NotFoundError('Ese bloque no existe');
    const actual = new Set((await this.records.listActual(athleteId)).map((a) => a.plannedSetId));
    return {
      blockKey,
      name: meso?.name ?? blockKey,
      sessions: new Set(active.map((s) => s.sessionKey)).size,
      sets: active.length,
      executedSets: active.filter((s) => actual.has(s.id)).length,
      hasFeedback: await this.programming.hasBlockFeedback(athleteId, blockKey),
    };
  }

  /** Todo lo de una semana, incluidas las series ya retiradas del plan que conservaban ejecución. */
  private async weekScope(athleteId: string, blockKey: string, weekNo: number) {
    const [all, actualRows, notes, finishes, micros] = await Promise.all([
      this.records.listPlanned(athleteId),
      this.records.listActual(athleteId),
      this.db.all<{ session_key: string }>(
        'SELECT session_key FROM athlete_exercise_notes WHERE athlete_id = ?',
        athleteId,
      ),
      this.db.all<{ session_key: string }>(
        'SELECT session_key FROM session_feedback WHERE athlete_id = ?',
        athleteId,
      ),
      this.programming.listMicros(athleteId),
    ]);
    const sets = all.filter((s) => s.blockKey === blockKey && s.weekNo === weekNo);
    const micro = micros.some((m) => m.blockKey === blockKey && m.weekNo === weekNo);
    if (!sets.length && !micro) throw new NotFoundError('Esa semana no existe');
    const ids = new Set(sets.map((s) => s.id));
    // las notas cuelgan de la sesión: solo se van las de sesiones que quedan enteras dentro de la semana
    const outside = new Set(all.filter((s) => !ids.has(s.id)).map((s) => s.sessionKey));
    const sessionKeys = [...new Set(sets.map((s) => s.sessionKey))].filter((k) => !outside.has(k));
    return {
      ids,
      sessionKeys,
      preview: {
        blockKey,
        weekNo,
        sessions: new Set(sets.map((s) => s.sessionKey)).size,
        sets: sets.length,
        executedSets: actualRows.filter((a) => ids.has(a.plannedSetId)).length,
        notes: [...notes, ...finishes].filter((n) => sessionKeys.includes(n.session_key)).length,
      },
    };
  }

  async previewWeek(athleteId: string, blockKey: string, weekNo: number) {
    return (await this.weekScope(athleteId, blockKey, weekNo)).preview;
  }

  /**
   * Eliminar una semana: sale del plan (queda una versión que lo explica) y se borran sus series y sus fechas. Con registros o notas
   * del atleta hay que confirmarlo. Las demás semanas conservan su número y sus fechas. Irreversible.
   */
  async removeWeek(athleteId: string, blockKey: string, weekNo: number, withExecution: boolean) {
    const { ids, sessionKeys, preview } = await this.weekScope(athleteId, blockKey, weekNo);
    if ((preview.executedSets > 0 || preview.notes > 0) && !withExecution)
      throw new ConflictError(
        'La semana tiene registros del atleta. Confirmá que también se borran para eliminarla.',
        { executedSets: preview.executedSets, notes: preview.notes },
      );
    const active = await this.records.listActivePlanned(athleteId);
    const keep = active.filter((s) => !ids.has(s.id));
    let versioned: { changed: boolean; note: string } | null = null;
    if (keep.length < active.length)
      versioned = await this.plans.importPlan(athleteId, {
        sets: keep,
        status: 'aplicado',
        replace: true,
        label: `Semana ${weekNo} eliminada${preview.executedSets ? ' (con su ejecución)' : ''}`,
      } as never);
    await this.db.transaction(async () => {
      for (const id of ids) {
        await this.db.run(
          'DELETE FROM actual_sets WHERE athlete_id = ? AND planned_set_id = ?',
          athleteId,
          id,
        );
        await this.db.run('DELETE FROM planned_sets WHERE athlete_id = ? AND id = ?', athleteId, id);
      }
      for (const key of sessionKeys) {
        await this.db.run(
          'DELETE FROM athlete_exercise_notes WHERE athlete_id = ? AND session_key = ?',
          athleteId,
          key,
        );
        await this.db.run(
          'DELETE FROM session_feedback WHERE athlete_id = ? AND session_key = ?',
          athleteId,
          key,
        );
      }
      await this.db.run(
        'DELETE FROM microcycles WHERE athlete_id = ? AND block_key = ? AND week_no = ?',
        athleteId,
        blockKey,
        weekNo,
      );
    });
    return { ...preview, plan: versioned };
  }

  async remove(athleteId: string, blockKey: string, withExecution: boolean) {
    const pv = await this.preview(athleteId, blockKey);
    if ((pv.executedSets > 0 || pv.hasFeedback) && !withExecution)
      throw new ConflictError(
        `El bloque tiene ${pv.executedSets} series ya registradas por el atleta${pv.hasFeedback ? ' y su cierre de bloque' : ''}. Confirmá que también se borran para eliminarlo.`,
        { executedSets: pv.executedSets },
      );
    const all = await this.records.listActivePlanned(athleteId);
    const keep = all.filter((s) => s.blockKey !== blockKey);
    let versioned: { changed: boolean; note: string } | null = null;
    if (pv.sets > 0)
      versioned = await this.plans.importPlan(athleteId, {
        sets: keep,
        status: 'aplicado',
        replace: true,
        label: `Bloque «${pv.name}» eliminado${pv.executedSets ? ' (con su ejecución)' : ''}`,
      } as never);
    await this.db.transaction(async () => {
      {
        await this.db.run(
          'DELETE FROM actual_sets WHERE athlete_id = ? AND planned_set_id IN (SELECT id FROM planned_sets WHERE athlete_id = ? AND block_key = ?)',
          athleteId,
          athleteId,
          blockKey,
        );
        await this.db.run(
          'DELETE FROM planned_sets WHERE athlete_id = ? AND block_key = ?',
          athleteId,
          blockKey,
        );
      }
      await this.programming.deleteBlockMeta(athleteId, blockKey);
    });
    return { ...pv, plan: versioned };
  }
}
