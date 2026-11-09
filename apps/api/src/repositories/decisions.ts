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

  list(athleteId: string, validity?: 'vigente' | 'expirada'): DecisionRow[] {
    const rows = validity
      ? this.db
          .prepare('SELECT payload FROM decisions WHERE athlete_id = ? AND validity = ?')
          .all(athleteId, validity)
      : this.db.prepare('SELECT payload FROM decisions WHERE athlete_id = ?').all(athleteId);
    return (rows as { payload: string }[]).map((r) =>
      upgradeDecisionRow(JSON.parse(r.payload) as Record<string, unknown>),
    );
  }
  get(athleteId: string, key: string): DecisionRow | null {
    const r = this.db
      .prepare('SELECT payload FROM decisions WHERE athlete_id = ? AND key = ?')
      .get(athleteId, key) as { payload: string } | undefined;
    return r ? upgradeDecisionRow(JSON.parse(r.payload) as Record<string, unknown>) : null;
  }
  /** Reemplaza el conjunto de decisiones del atleta por el resultado de la fusión (idempotente). Nunca borra: lo que no aplica queda "expirada". */
  saveAll(athleteId: string, rows: DecisionRow[]): void {
    const st = this.db
      .prepare(`INSERT INTO decisions (athlete_id, key, lift, rule_id, validity, coach_decision, evaluated_on, payload) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT (athlete_id, key) DO UPDATE SET validity=excluded.validity, coach_decision=excluded.coach_decision, evaluated_on=excluded.evaluated_on, payload=excluded.payload`);
    for (const r of rows)
      st.run(
        athleteId,
        r.key,
        r.lift,
        r.ruleId,
        r.validity,
        legacyDecision(r.lifecycle),
        r.evaluatedOn,
        JSON.stringify({ ...r, coachDecision: legacyDecision(r.lifecycle) }),
      );
  }
  /** Fija el ciclo de vida de un hallazgo (la intervención con sus fechas vive aparte). */
  setLifecycle(
    athleteId: string,
    key: string,
    lifecycle: Lifecycle,
    patch: { interventionId?: string | null; coachNote?: string; decidedOn?: string },
  ): DecisionRow | null {
    const cur = this.get(athleteId, key);
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
  decide(
    athleteId: string,
    key: string,
    decision: CoachDecision,
    note: string,
    on: string,
  ): DecisionRow | null {
    return this.setLifecycle(athleteId, key, lifecycleFromLegacy(decision), {
      coachNote: note,
      decidedOn: decision === 'Pendiente' ? '' : on,
    });
  }
  saveEvaluation(athleteId: string, ev: AthleteEvaluation): void {
    this.db
      .prepare(
        `INSERT INTO evaluations (athlete_id, cutoff, rules_version, payload) VALUES (?,?,?,?)
      ON CONFLICT (athlete_id, cutoff, rules_version) DO UPDATE SET payload=excluded.payload`,
      )
      .run(athleteId, ev.cutoff, ev.rulesVersion, JSON.stringify(ev));
  }
  /** Última evaluación. Si es de una versión anterior (sin estado multidimensional) se devuelve null: hay que reevaluar. */
  latestEvaluation(athleteId: string): AthleteEvaluation | null {
    const r = this.db
      .prepare(
        'SELECT payload FROM evaluations WHERE athlete_id = ? ORDER BY cutoff DESC, rules_version DESC LIMIT 1',
      )
      .get(athleteId) as { payload: string } | undefined;
    if (!r) return null;
    const payload = JSON.parse(r.payload) as Record<string, unknown>;
    return isLegacyEvaluation(payload) ? null : (payload as unknown as AthleteEvaluation);
  }
  hasLegacyEvaluation(athleteId: string): boolean {
    const r = this.db
      .prepare('SELECT payload FROM evaluations WHERE athlete_id = ? ORDER BY cutoff DESC LIMIT 1')
      .get(athleteId) as { payload: string } | undefined;
    return !!r && isLegacyEvaluation(JSON.parse(r.payload) as Record<string, unknown>);
  }
}
