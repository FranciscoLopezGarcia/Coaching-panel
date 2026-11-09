/** Compatibilidad de presentación: SessionRow todavía declara un protocolo anterior al campo repsMax. */
export function repsMaxOf(protocol: unknown): number | null {
  if (!protocol || typeof protocol !== 'object' || !('repsMax' in protocol)) return null;
  return typeof protocol.repsMax === 'number' && Number.isFinite(protocol.repsMax) ? protocol.repsMax : null;
}
export function prescribedReps(reps: number | undefined, protocol: unknown): string {
  if (reps === undefined) return '—';
  const max = repsMaxOf(protocol);
  return max !== null && max !== reps ? `${reps}–${max}` : String(reps);
}
export function validateRepsRange(reps: string, max: string): string {
  return max && Number(max.replace(',', '.')) < Number(reps.replace(',', '.'))
    ? 'Las repeticiones máximas no pueden ser menores que las mínimas.'
    : '';
}
