/**
 * Sincronización en vivo coach ↔ atleta. Cada atleta tiene una «revisión» que sube con CADA escritura que le afecta
 * (plan, ajustes de vista, series registradas, check-ins). Los clientes abiertos reciben el aviso al instante por SSE y vuelven a pedir
 * lo suyo; si el canal se corta, preguntan la revisión cada pocos segundos (respaldo). La revisión arranca en la hora de inicio del
 * proceso: tras reiniciar el servidor, todo cliente ve un número distinto y recarga.
 */
type Listener = (rev: number) => void;
const START = Date.now();
export class LiveBus {
  private readonly revs = new Map<string, number>();
  private readonly subs = new Map<string, Set<Listener>>();
  rev(athleteId: string): number {
    return this.revs.get(athleteId) ?? START;
  }
  bump(athleteId: string): number {
    const next = Math.max(this.rev(athleteId) + 1, Date.now());
    this.revs.set(athleteId, next);
    for (const l of this.subs.get(athleteId) ?? []) {
      try {
        l(next);
      } catch {
        /* un cliente caído no frena a los demás */
      }
    }
    return next;
  }
  subscribe(athleteId: string, l: Listener): () => void {
    const set = this.subs.get(athleteId) ?? new Set<Listener>();
    set.add(l);
    this.subs.set(athleteId, set);
    return () => {
      set.delete(l);
    };
  }
  listeners(athleteId: string): number {
    return this.subs.get(athleteId)?.size ?? 0;
  }
}
