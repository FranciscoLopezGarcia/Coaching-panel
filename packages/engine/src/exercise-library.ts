import { musclesFor, patternFor, type MovementPattern, type MuscleContribution } from './muscles.js';
import type { Lift } from './types.js';

/**
 * Biblioteca FIJA de ejercicios (convención del proyecto, en español). El coach puede sumar ejercicios propios (se guardan aparte).
 * Músculos y patrón NO se escriben acá: salen de las mismas reglas por nombre que usa el análisis, así biblioteca y análisis no se contradicen.
 * `lift` = movimiento de competencia al que pertenece la variante (null = accesorio general). `role` es solo una sugerencia al programar.
 */
export interface LibraryEntry {
  name: string;
  lift: Lift | null;
  role: 'primaria' | 'secundaria' | 'accesorio';
  equipment: string;
}

const e = (name: string, lift: Lift | null, role: LibraryEntry['role'], equipment: string): LibraryEntry => ({
  name,
  lift,
  role,
  equipment,
});

export const FIXED_EXERCISES: readonly LibraryEntry[] = [
  // Sentadilla
  e('Sentadilla competencia', 'SQ', 'primaria', 'barra'),
  e('Sentadilla con pausa', 'SQ', 'secundaria', 'barra'),
  e('Sentadilla con cajón', 'SQ', 'secundaria', 'barra'),
  e('Sentadilla frontal', 'SQ', 'secundaria', 'barra'),
  e('Sentadilla safety bar', 'SQ', 'secundaria', 'barra'),
  e('Sentadilla con tempo', 'SQ', 'secundaria', 'barra'),
  e('Sentadilla goblet', 'SQ', 'accesorio', 'mancuerna'),
  e('Sentadilla búlgara', null, 'accesorio', 'mancuernas'),
  e('Zancada', null, 'accesorio', 'mancuernas'),
  e('Prensa de piernas', null, 'accesorio', 'máquina'),
  e('Sentadilla hack', null, 'accesorio', 'máquina'),
  e('Extensión de piernas', null, 'accesorio', 'máquina'),
  // Banca
  e('Press banca competencia', 'BP', 'primaria', 'barra'),
  e('Press banca con pausa', 'BP', 'secundaria', 'barra'),
  e('Press banca agarre cerrado', 'BP', 'secundaria', 'barra'),
  e('Press banca spoto', 'BP', 'secundaria', 'barra'),
  e('Press banca con pin', 'BP', 'secundaria', 'barra'),
  e('Press banca inclinado', 'BP', 'secundaria', 'barra'),
  e('Press con mancuernas', 'BP', 'accesorio', 'mancuernas'),
  e('Fondos', null, 'accesorio', 'peso corporal'),
  e('Aperturas', null, 'accesorio', 'mancuernas'),
  e('Press militar', null, 'accesorio', 'barra'),
  e('Press de hombros con mancuernas', null, 'accesorio', 'mancuernas'),
  e('Elevaciones laterales', null, 'accesorio', 'mancuernas'),
  e('Extensión de tríceps en polea', null, 'accesorio', 'polea'),
  e('Press francés', null, 'accesorio', 'barra Z'),
  // Peso muerto
  e('Peso muerto competencia', 'DL', 'primaria', 'barra'),
  e('Peso muerto sumo', 'DL', 'primaria', 'barra'),
  e('Peso muerto con déficit', 'DL', 'secundaria', 'barra'),
  e('Peso muerto con pausa', 'DL', 'secundaria', 'barra'),
  e('Peso muerto desde bloques', 'DL', 'secundaria', 'barra'),
  e('Peso muerto rumano', 'DL', 'accesorio', 'barra'),
  e('Buenos días', null, 'accesorio', 'barra'),
  e('Empuje de cadera', null, 'accesorio', 'barra'),
  e('Hiperextensiones', null, 'accesorio', 'banco'),
  e('Curl femoral', null, 'accesorio', 'máquina'),
  // Tirones
  e('Remo con barra', null, 'accesorio', 'barra'),
  e('Remo con mancuerna', null, 'accesorio', 'mancuerna'),
  e('Remo en polea', null, 'accesorio', 'polea'),
  e('Remo en máquina', null, 'accesorio', 'máquina'),
  e('Jalón al pecho', null, 'accesorio', 'polea'),
  e('Dominadas', null, 'accesorio', 'peso corporal'),
  e('Face pull', null, 'accesorio', 'polea'),
  e('Vuelos posteriores', null, 'accesorio', 'mancuernas'),
  // Brazos y core
  e('Curl de bíceps con barra', null, 'accesorio', 'barra'),
  e('Curl martillo', null, 'accesorio', 'mancuernas'),
  e('Abdominales en polea', null, 'accesorio', 'polea'),
  e('Plancha', null, 'accesorio', 'peso corporal'),
  e('Rueda abdominal', null, 'accesorio', 'rueda'),
];

export interface LibraryItem extends LibraryEntry {
  /** 'fija' = viene con el sistema; 'propia' = la cargó el coach. */
  origin: 'fija' | 'propia';
  id: string | null;
  pattern: MovementPattern | null;
  muscles: MuscleContribution[] | null;
  notes: string;
}

/** Ficha de un ejercicio de la biblioteca fija, con músculos y patrón derivados de las reglas del análisis. */
export function fixedItems(): LibraryItem[] {
  return FIXED_EXERCISES.map((x) => ({
    ...x,
    origin: 'fija',
    id: null,
    pattern: patternFor(x.name, x.name),
    muscles: musclesFor(x.name, x.name),
    notes: '',
  }));
}
