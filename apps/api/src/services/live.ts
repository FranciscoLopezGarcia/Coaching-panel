import type { Db } from '../db/connection.js';

/**
 * Sincronización en vivo coach ↔ atleta. Cada atleta tiene una «revisión» (tabla athlete_rev) que sube con CADA escritura que le
 * afecta (plan, ajustes de vista, series registradas, check-ins, notas). Los clientes la consultan (sondeo corto) y, si cambió, vuelven
 * a pedir lo que muestran. Vive en la base, no en memoria: sirve igual con varias instancias del servidor (Vercel). Con un proceso
 * único (local) además se avisa por SSE al instante a los suscriptores de ese proceso.
 */
type Listener = (rev: number) => void;
export class LiveBus {
  private readonly subs = new Map<string, Set<Listener>>();
  constructor(private db: Db) {}
  async rev(athleteId: string): Promise<number> {
    const r = await this.db.get<{ rev: number }>(
      'SELECT rev FROM athlete_rev WHERE athlete_id = ?',
      athleteId,
    );
    return Number(r?.rev ?? 0);
  }
  async bump(athleteId: string): Promise<number> {
    const next = Date.now();
    // max(ahora, anterior + 1): estrictamente creciente aunque dos escrituras caigan en el mismo milisegundo
    await this.db.run(
      `INSERT INTO athlete_rev (athlete_id, rev) VALUES (?, ?)
       ON CONFLICT (athlete_id) DO UPDATE SET rev = MAX(excluded.rev, athlete_rev.rev + 1)`,
      athleteId,
      next,
    );
    const rev = await this.rev(athleteId);
    for (const l of this.subs.get(athleteId) ?? []) {
      try {
        l(rev);
      } catch {
        /* un cliente caído no frena a los demás */
      }
    }
    return rev;
  }
  subscribe(athleteId: string, l: Listener): () => void {
    const set = this.subs.get(athleteId) ?? new Set<Listener>();
    set.add(l);
    this.subs.set(athleteId, set);
    return () => {
      set.delete(l);
    };
  }
}
