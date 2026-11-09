/** Clasificación por nombre de los movimientos de competición y sus variantes (los accesorios devuelven null). Solo para la demo: el motor no infiere. */
export type Lift = 'SQ' | 'BP' | 'DL';
export function liftOfName(name: string): Lift | null {
  const n = name.toLowerCase().trim();
  if (/^(squat|sentadilla|sq)\b/.test(n)) {
    return /belt squat|hack|prensa|bulgar|goblet|split|zercher|cossac|cosack|pistol|sissy|platz/.test(n)
      ? null
      : 'SQ';
  }
  if (/^(deadlift|deadlit|peso muerto|dl)\b/.test(n)) {
    return /rumano|rdl|stiff|zercher|jefferson/.test(n) ? null : 'DL';
  }
  if (/^(bench ?press|bench|bp|press banca|banca|spoto)\b/.test(n)) {
    return /inclin|declin|unilateral|mnc|mancuerna|dumbbell|smith|low incline/.test(n) ? null : 'BP';
  }
  return null;
}
