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
    };
  }

  async remove(athleteId: string, blockKey: string, withExecution: boolean) {
    const pv = await this.preview(athleteId, blockKey);
    if (pv.executedSets > 0 && !withExecution)
      throw new ConflictError(
        `El bloque tiene ${pv.executedSets} series ya registradas por el atleta. Confirmá que también se borran para eliminarlo.`,
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
