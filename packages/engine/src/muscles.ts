/**
 * Convención de aportes por grupo muscular (v2). [propuesta del proyecto]
 *  - Aporte DIRECTO = peso 1,0; INDIRECTO = peso 0,5 (regla oficial de Hevy para "series por grupo": primario 1, secundario 0,5).
 *  - La ASIGNACIÓN ejercicio→grupos de esta tabla es del proyecto y NO está verificada contra el mapeo interno de Hevy.
 *  - "Series equivalentes" de un músculo = Σ series × peso. NO es NL (suma de repeticiones por movimiento) ni tonelaje.
 *  - Un músculo puede recibir aporte de varios ejercicios, y un ejercicio aporta a varios músculos: NO se suman músculos en un "total"
 *    sin duplicados. Cada grupo se informa por separado, con directo e indirecto discriminados.
 *  - Ejercicio ausente de la tabla → sus métricas musculares quedan NO DISPONIBLES (no se adivina).
 */
export const MUSCLE_CONVENTION_VERSION = 'musculos-v2';
export const DIRECT_WEIGHT = 1;
export const INDIRECT_WEIGHT = 0.5;

export const MUSCLE_GROUPS = [
  'cuadriceps',
  'gluteos',
  'isquiotibiales',
  'pantorrillas',
  'aductores',
  'abductores',
  'espalda_baja',
  'dorsales',
  'espalda_alta',
  'trapecio',
  'pectoral',
  'hombros',
  'biceps',
  'triceps',
  'antebrazos',
  'core',
  'oblicuos',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

interface Contribution {
  direct: MuscleGroup[];
  indirect: MuscleGroup[];
}

const c = (direct: MuscleGroup[], indirect: MuscleGroup[] = []): Contribution => ({ direct, indirect });

const SQUAT = c(['cuadriceps', 'gluteos'], ['isquiotibiales', 'aductores', 'espalda_baja', 'core']);
const BENCH = c(['pectoral'], ['triceps', 'hombros']);
const DEAD = c(
  ['gluteos', 'isquiotibiales', 'espalda_baja'],
  ['cuadriceps', 'dorsales', 'trapecio', 'antebrazos', 'core'],
);

/** Claves = exerciseId canónico (ver `canonicalExercise`). Tienen prioridad sobre las reglas por nombre. */
export const EXERCISE_MUSCLES: Record<string, Contribution> = {
  'squat-barbell': SQUAT,
  'squat-comp': SQUAT,
  'squat-pausa': SQUAT,
  'bench-press-barbell': BENCH,
  'bench-comp': BENCH,
  'deadlift-barbell': DEAD,
  'deadlift-comp': DEAD,
  'sumo-deadlift': DEAD,
};

/**
 * Reglas por NOMBRE del ejercicio (slug en minúsculas con guiones). Se evalúan en orden: gana la primera que coincide.
 * Son una convención del proyecto sobre nombres típicos (incluye los de Hevy); un ejercicio que no coincide con ninguna queda SIN músculos
 * (no se adivina) y se informa como no mapeado.
 */
const RULES: { re: RegExp; v: Contribution }[] = [
  // --- nombres en español y abreviaturas habituales de powerlifting (convención del proyecto; ante duda, el ejercicio queda sin mapear)
  // posteriores antes que 'fly' (pecho)
  {
    re: /rear-delt|reverse-fly|reverse-pec|face-pull|rear-lateral|bent-over-lateral/,
    v: c(['hombros', 'espalda_alta'], ['trapecio']),
  },
  { re: /extension-(de-)?(cuadricep|pierna)|cuadricep/, v: c(['cuadriceps']) },
  { re: /adduction/, v: c(['aductores']) },
  { re: /abduction/, v: c(['abductores', 'gluteos']) },
  {
    re: /pullapart|pull-apart|y-raise|vuelos?-(posteriores|ywt)|ywt|vuelo-posterior/,
    v: c(['hombros', 'espalda_alta'], ['trapecio']),
  },
  { re: /militar|press-militar/, v: c(['hombros'], ['triceps', 'trapecio', 'core']) },
  { re: /(^|-)(sq|squat)-(safety|box|pausa|paused)|safety-bar|sq-safety/, v: SQUAT },
  { re: /(^|-)(dl|sumo-dl|conv)(-|$)|bloq|suml/, v: DEAD },
  { re: /press-banca|banca|spoto|larsen|pin-press|california-press|reverse-band-bp|(^|-)bp(-|$)/, v: BENCH },
  // --- piernas (específicos primero)
  { re: /leg-extension/, v: c(['cuadriceps']) },
  {
    re: /(seated|lying|standing|laying)-leg-curl|hamstring-curl|leg-curl|nordic|glute-ham|ghr/,
    v: c(['isquiotibiales'], ['pantorrillas']),
  },
  {
    re: /romanian|stiff-leg|straight-leg-deadlift|good-morning|rdl|single-leg-deadlift/,
    v: c(['isquiotibiales', 'gluteos', 'espalda_baja'], ['core', 'antebrazos', 'aductores']),
  },
  { re: /deadlift|rack-pull|trap-bar|block-pull|deficit/, v: DEAD },
  {
    re: /hip-thrust|glute-bridge|hip-bridge|pull-through|donkey-kick|glute-kickback|kickback-machine|cable-kickback/,
    v: c(['gluteos'], ['isquiotibiales', 'core']),
  },
  {
    re: /back-extension|hyperextension|reverse-hyper/,
    v: c(['espalda_baja', 'gluteos'], ['isquiotibiales']),
  },
  { re: /calf|donkey-calf|tibialis/, v: c(['pantorrillas']) },
  { re: /adductor|copenhagen/, v: c(['aductores']) },
  {
    re: /abductor|clamshell|lateral-walk|monster-walk|banded-walk|fire-hydrant/,
    v: c(['abductores', 'gluteos']),
  },
  {
    re: /leg-press|hack-squat|sissy|pendulum|belt-squat/,
    v: c(['cuadriceps', 'gluteos'], ['aductores', 'isquiotibiales']),
  },
  {
    re: /split-squat|bulgarian|lunge|step-up|step-down|pistol|cossack/,
    v: c(['cuadriceps', 'gluteos'], ['isquiotibiales', 'aductores', 'core']),
  },
  { re: /squat|goblet|zercher|thruster/, v: SQUAT },
  // --- empuje horizontal / pecho
  { re: /close-grip-bench|jm-press|floor-press|board-press/, v: c(['triceps', 'pectoral'], ['hombros']) },
  { re: /bench|chest-press|push-up|pushup|press-up|svend/, v: BENCH },
  { re: /chest-dip|dips?(-|$)|^dip|bench-dip/, v: c(['triceps', 'pectoral'], ['hombros']) },
  { re: /fly|flye|pec-deck|crossover|cross-over|pec-fly/, v: c(['pectoral'], ['hombros']) },
  { re: /incline.*press|decline.*press/, v: BENCH },
  // --- hombros
  { re: /lateral-raise|side-raise|front-raise|plate-raise/, v: c(['hombros'], ['trapecio']) },
  { re: /upright-row/, v: c(['hombros', 'trapecio'], ['biceps']) },
  { re: /shrug|trap-raise/, v: c(['trapecio'], ['antebrazos']) },
  {
    re: /overhead-press|shoulder-press|military|arnold|push-press|landmine-press|strict-press|seated-press|ohp|jerk/,
    v: c(['hombros'], ['triceps', 'trapecio', 'core']),
  },
  // --- tirón
  {
    re: /pull-?up|chin-?up|pulldown|lat-pull|muscle-up|assisted-pull/,
    v: c(['dorsales'], ['biceps', 'espalda_alta', 'antebrazos']),
  },
  { re: /pullover|straight-arm/, v: c(['dorsales'], ['pectoral', 'triceps']) },
  { re: /row/, v: c(['dorsales', 'espalda_alta'], ['biceps', 'hombros', 'antebrazos', 'espalda_baja']) },
  // --- brazos
  { re: /wrist-curl|reverse-wrist|wrist-roller|grip|dead-hang|farmer|plate-pinch/, v: c(['antebrazos']) },
  { re: /hammer-curl|reverse-curl|zottman/, v: c(['biceps', 'antebrazos']) },
  { re: /curl|chin-up-underhand/, v: c(['biceps'], ['antebrazos']) },
  {
    re: /tricep|skull|pushdown|push-down|kickback|french-press|overhead-extension|triceps/,
    v: c(['triceps']),
  },
  // --- core
  {
    re: /russian-twist|woodchop|wood-chop|side-bend|oblique|pallof|suitcase|windmill|landmine-twist|heel-touch/,
    v: c(['oblicuos'], ['core']),
  },
  {
    re: /crunch|sit-up|situp|leg-raise|knee-raise|plank|ab-wheel|rollout|hanging|dead-bug|hollow|toes-to-bar|v-up|flutter|bicycle|mountain-climber|l-sit|core/,
    v: c(['core'], ['oblicuos']),
  },
  // --- cuerpo completo / transportes
  { re: /carry|walk-with|yoke/, v: c(['antebrazos', 'trapecio', 'core'], ['gluteos', 'cuadriceps']) },
  {
    re: /clean|snatch|swing|burpee/,
    v: c(['gluteos', 'isquiotibiales', 'espalda_baja'], ['cuadriceps', 'trapecio', 'hombros', 'core']),
  },
];

/** Cardio y similares: no aportan a la convención de fuerza (quedan sin mapear, no se adivinan). */
const NOT_STRENGTH =
  /rowing-machine|treadmill|running|jogging|cycling|bike|elliptical|stair-?(master|climber)|jump-rope|skipping|ski-erg|swimming|walking$|stretch|foam-roll|yoga/;

export interface MuscleContribution {
  group: MuscleGroup;
  kind: 'directo' | 'indirecto';
  weight: number;
}

const slugOf = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function toList(v: Contribution): MuscleContribution[] {
  return [
    ...v.direct.map((g) => ({ group: g, kind: 'directo' as const, weight: DIRECT_WEIGHT })),
    ...v.indirect
      .filter((g) => !v.direct.includes(g))
      .map((g) => ({ group: g, kind: 'indirecto' as const, weight: INDIRECT_WEIGHT })),
  ];
}

/** Aportes de un ejercicio (id canónico o nombre), o null si no está en la convención (métrica no disponible). */
export function musclesFor(exerciseId: string, exerciseName?: string): MuscleContribution[] | null {
  const exact = EXERCISE_MUSCLES[exerciseId];
  if (exact) return toList(exact);
  const slug = slugOf(exerciseName ?? exerciseId);
  if (NOT_STRENGTH.test(slug)) return null;
  const hit = RULES.find((r) => r.re.test(slug)) ?? RULES.find((r) => r.re.test(slugOf(exerciseId)));
  return hit ? toList(hit.v) : null;
}

/**
 * Aportes de una serie. Si el coach eligió el grupo muscular al programar, ese grupo manda: entra como DIRECTO (peso 1) y se conservan los
 * demás aportes que la convención por nombre le asigna (si los tiene). Sin elección → solo la convención por nombre.
 */
export function musclesForSet(s: {
  exerciseId: string;
  exerciseName: string;
  muscleGroup?: MuscleGroup | null;
}): MuscleContribution[] | null {
  const byName = musclesFor(s.exerciseId, s.exerciseName);
  if (!s.muscleGroup) return byName;
  const rest = (byName ?? []).filter((m) => m.group !== s.muscleGroup);
  return [{ group: s.muscleGroup, kind: 'directo', weight: DIRECT_WEIGHT }, ...rest];
}

/** Cuántas reglas y grupos tiene la convención (para mostrar cobertura). */
export const MUSCLE_RULE_COUNT = RULES.length;

/* ---------------- Patrón de movimiento (otra dimensión, distinta del grupo muscular) ---------------- */
/**
 * Patrón de movimiento (`patrones-v1`, convención del proyecto). A diferencia del grupo muscular, CADA ejercicio pertenece a UN solo patrón:
 * por eso las series, el NL y el tonelaje por patrón SÍ se pueden sumar (su suma es el total). Un ejercicio sin regla queda sin patrón.
 */
export const PATTERN_CONVENTION_VERSION = 'patrones-v1';
export const MOVEMENT_PATTERNS = [
  'sentadilla',
  'bisagra_cadera',
  'unilateral_pierna',
  'empuje_horizontal',
  'empuje_vertical',
  'traccion_horizontal',
  'traccion_vertical',
  'aislamiento_pierna',
  'aislamiento_brazos',
  'aislamiento_hombro_espalda',
  'core',
  'transporte_olimpico',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

const PATTERN_RULES: { re: RegExp; p: MovementPattern }[] = [
  {
    re: /leg-extension|extension-(de-)?(cuadricep|pierna)|cuadricep|(seated|lying|standing|laying)-leg-curl|hamstring-curl|leg-curl|nordic|glute-ham|ghr|calf|donkey-calf|tibialis|adduct|abduct|copenhagen|clamshell|lateral-walk|monster-walk|banded-walk|fire-hydrant|kickback-machine|glute-kickback|donkey-kick/,
    p: 'aislamiento_pierna',
  },
  {
    re: /russian-twist|woodchop|wood-chop|side-bend|oblique|pallof|suitcase|windmill|crunch|sit-up|situp|leg-raise|knee-raise|plank|ab-wheel|rollout|hanging|dead-bug|hollow|toes-to-bar|v-up|flutter|bicycle|mountain-climber|l-sit|(^|-)core(-|$)/,
    p: 'core',
  },
  { re: /farmer|carry|walk-with|yoke|clean|snatch|swing|burpee|jerk/, p: 'transporte_olimpico' },
  {
    re: /rear-delt|reverse-fly|reverse-pec|face-pull|rear-lateral|bent-over-lateral|pullapart|pull-apart|y-raise|vuelos?-(posteriores|ywt)|ywt|vuelo-posterior|lateral-raise|side-raise|front-raise|plate-raise|upright-row|shrug|trap-raise/,
    p: 'aislamiento_hombro_espalda',
  },
  {
    re: /wrist|grip|dead-hang|plate-pinch|hammer-curl|reverse-curl|zottman|curl|tricep|skull|pushdown|push-down|kickback|french-press|overhead-extension|triceps/,
    p: 'aislamiento_brazos',
  },
  {
    re: /romanian|stiff-leg|straight-leg-deadlift|good-morning|rdl|single-leg-deadlift|deadlift|rack-pull|trap-bar|block-pull|deficit|(^|-)(dl|sumo-dl|conv)(-|$)|bloq|suml|hip-thrust|glute-bridge|hip-bridge|pull-through|back-extension|hyperextension|reverse-hyper/,
    p: 'bisagra_cadera',
  },
  { re: /split-squat|bulgarian|lunge|step-up|step-down|pistol|cossack/, p: 'unilateral_pierna' },
  {
    re: /leg-press|hack-squat|sissy|pendulum|belt-squat|squat|goblet|zercher|thruster|(^|-)sq(-|$)/,
    p: 'sentadilla',
  },
  {
    re: /overhead-press|shoulder-press|military|militar|arnold|push-press|landmine-press|strict-press|seated-press|ohp/,
    p: 'empuje_vertical',
  },
  {
    re: /bench|banca|chest-press|push-up|pushup|press-up|svend|spoto|larsen|pin-press|california-press|close-grip|jm-press|floor-press|board-press|chest-dip|dips?(-|$)|^dip|bench-dip|fly|flye|pec-deck|crossover|cross-over|incline.*press|decline.*press|(^|-)bp(-|$)/,
    p: 'empuje_horizontal',
  },
  {
    re: /pull-?up|chin-?up|pulldown|lat-pull|muscle-up|assisted-pull|pullover|straight-arm/,
    p: 'traccion_vertical',
  },
  { re: /row/, p: 'traccion_horizontal' },
];

/** Patrón de movimiento de un ejercicio (id canónico o nombre), o null si no está en la convención. */
export function patternFor(exerciseId: string, exerciseName?: string): MovementPattern | null {
  const slug = slugOf(exerciseName ?? exerciseId);
  if (NOT_STRENGTH.test(slug)) return null;
  const hit =
    PATTERN_RULES.find((r) => r.re.test(slug)) ?? PATTERN_RULES.find((r) => r.re.test(slugOf(exerciseId)));
  return hit?.p ?? null;
}
