import {
  MUSCLE_GROUPS,
  fixedItems,
  musclesFor,
  muscleMapKey,
  patternFor,
  type LibraryItem,
  type MuscleGroup,
  type MuscleMap,
} from '@coaching/engine';
import type { CustomExerciseRow } from '../repositories/extras.js';

const known = new Set<string>(MUSCLE_GROUPS);
const onlyKnown = (xs: string[]): MuscleGroup[] => xs.filter((g): g is MuscleGroup => known.has(g));

/** Mapa de músculos de los ejercicios PROPIOS del coach (solo los que declaran músculos). El mapa del atleta gana sobre este. */
export function libraryMuscleMap(custom: CustomExerciseRow[]): MuscleMap {
  const map: MuscleMap = {};
  for (const e of custom) {
    const direct = onlyKnown(e.muscles.direct);
    const indirect = onlyKnown(e.muscles.indirect);
    if (direct.length || indirect.length) map[muscleMapKey(e.name)] = { direct, indirect };
  }
  return map;
}

/** Biblioteca completa: la fija del sistema + los ejercicios propios. Un propio con el mismo nombre que uno fijo lo reemplaza. */
export function fullLibrary(custom: CustomExerciseRow[]): LibraryItem[] {
  const own = new Set(custom.map((c) => muscleMapKey(c.name)));
  const fixed = fixedItems().filter((f) => !own.has(muscleMapKey(f.name)));
  const mine: LibraryItem[] = custom.map((c) => {
    const direct = onlyKnown(c.muscles.direct);
    const indirect = onlyKnown(c.muscles.indirect);
    const declared = direct.length || indirect.length;
    return {
      name: c.name,
      lift: c.lift,
      role: 'accesorio',
      equipment: c.equipment,
      origin: 'propia',
      id: c.id,
      pattern: ((c.pattern || null) as LibraryItem['pattern']) ?? patternFor(c.name, c.name),
      muscles: declared
        ? [
            ...direct.map((group) => ({ group, kind: 'directo' as const, weight: 1 })),
            ...indirect
              .filter((g) => !direct.includes(g))
              .map((group) => ({ group, kind: 'indirecto' as const, weight: 0.5 })),
          ]
        : musclesFor(c.name, c.name),
      notes: c.notes,
    };
  });
  return [...fixed, ...mine].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}
