import {
  legacyDecision,
  lifecycleFromLegacy,
  type AthleteEvaluation,
  type CoachDecision,
  type DecisionRow,
  type Lifecycle,
} from '@coaching/engine';
import type { Db } from '../db/connection.js';
import { isLegacyEvaluation, upgradeDecisionRow } from './legacy.js';

export class DecisionsRepo {
  constructor(private db: Db) {}

  async list(athleteId: string, validity?: 'vigente' | 'expirada'): Promise<DecisionRow[]> {
    const rows = validity
      ? await this.db.all(
          'SELECT payload FROM decisions WHERE athlete_id = ? AND validity = ?',
          athleteId,
          validity,
        )
      : await this.db.all('SELECT payload FROM decisions WHERE athlete_id = ?', athleteId);
    return (rows as { payload: string }[]).map((r) =>
      upgradeDecisionRow(JSON.parse(r.payload) as Record<string, unknown>),
    );
  }
  async get(athleteId: string, key: string): Promise<DecisionRow | null> {
    const r = (await this.db.get(
      'SELECT payload FROM decisions WHERE athlete_id = ? AND key = ?',
      athleteId,
      key,
    )) as { payload: string } | undefined;
    return r ? upgradeDecisionRow(JSON.parse(r.payload) as Record<string, unknown>) : null;
  }
  /** Reemplaza el conjunto de decisiones del atleta por el resultado de la fusión (idempotente). Nunca borra: lo que no aplica queda "expirada". */
  async saveAll(athleteId: string, rows: DecisionRow[]): Promise<void> {
    const sql = `INSERT INTO decisions (athlete_id, key, lift, rule_id, validity, coach_decision, evaluated_on, payload) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, key) DO UPDATE SET validity=excluded.validity, coach_decision=excluded.coach_decision, evaluated_on=excluded.evaluated_on, payload=excluded.payload`;
    await this.db.runMany(
      sql,
      rows.map((r) => [
        athleteId,
        r.key,
        r.lift,
        r.ruleId,
        r.validity,
        legacyDecision(r.lifecycle),
        r.evaluatedOn,
        JSON.stringify({ ...r, coachDecision: legacyDecision(r.lifecycle) }),
      ]),
    );
  }
  /** Fija el ciclo de vida de un hallazgo (la intervención con sus fechas vive aparte). */
  async setLifecycle(
    athleteId: string,
    key: string,
    lifecycle: Lifecycle,
    patch: { interventionId?: string | null; coachNote?: string; decidedOn?: string },
  ): Promise<DecisionRow | null> {
    const cur = await this.get(athleteId, key);
    if (!cur) return null;
    const row: DecisionRow = {
      ...cur,
      lifecycle,
      coachDecision: legacyDecision(lifecycle),
      interventionId: patch.interventionId === undefined ? cur.interventionId : patch.interventionId,
      coachNote: patch.coachNote ?? cur.coachNote,
      decidedOn: patch.decidedOn ?? cur.decidedOn,
    };
    this.saveAll(athleteId, [row]);
    return row;
  }
  /** @deprecated Compatibilidad con el contrato anterior (`coachDecision`): se traduce a ciclo de vida. "Aprobada" NO significa aplicada. */
  async decide(
    athleteId: string,
    key: string,
    decision: CoachDecision,
    note: string,
    on: string,
  ): Promise<DecisionRow | null> {
    return await this.setLifecycle(athleteId, key, lifecycleFromLegacy(decision), {
      coachNote: note,
      decidedOn: decision === 'Pendiente' ? '' : on,
    });
  }
  async saveEvaluation(athleteId: string, ev: AthleteEvaluation): Promise<void> {
    await this.db.run(
      `INSERT INTO evaluations (athlete_id, cutoff, rules_version, payload) VALUES (?,?,?,?)
      ON CONFLICT (athlete_id, cutoff, rules_version) DO UPDATE SET payload=excluded.payload`,
      athleteId,
      ev.cutoff,
      ev.rulesVersion,
      JSON.stringify(ev),
    );
  }
  /** Última evaluación. Si es de una versión anterior (sin estado multidimensional) se devuelve null: hay que reevaluar. */
  async latestEvaluation(athleteId: string): Promise<AthleteEvaluation | null> {
    const r = (await this.db.get(
      'SELECT payload FROM evaluations WHERE athlete_id = ? ORDER BY cutoff DESC, rules_version DESC LIMIT 1',
      athleteId,
    )) as { payload: string } | undefined;
    if (!r) return null;
    const payload = JSON.parse(r.payload) as Record<string, unknown>;
    return isLegacyEvaluation(payload) ? null : (payload as unknown as AthleteEvaluation);
  }
  async hasLegacyEvaluation(athleteId: string): Promise<boolean> {
    const r = (await this.db.get(
      'SELECT payload FROM evaluations WHERE athlete_id = ? ORDER BY cutoff DESC LIMIT 1',
      athleteId,
    )) as { payload: string } | undefined;
    return !!r && isLegacyEvaluation(JSON.parse(r.payload) as Record<string, unknown>);
  }
}
