/**
 * Familias de la pantalla Analizar: cada magnitud vive en UNA sola. La tarjeta de cada familia trae su gráfico y su tabla vinculados.
 * Solo textos de presentación: las métricas, unidades y escalas salen del registro del servidor.
 */
export interface Family {
  id: string;
  title: string;
  hint: string;
  /** Ids del registro de métricas que pertenecen a la familia. */
  metrics: string[];
  /** Existe vista «por bloque» (rango de semanas + deltas) para las métricas de la familia. */
  blockView: boolean;
  /** Mostrar todas las métricas en el gráfico al abrir (solo si comparten unidad y familia de escala). */
  showAll?: boolean;
}

export const FAMILIES: Family[] = [
  {
    id: 'volumen',
    title: 'Volumen',
    hint: 'Cuánto se levantó: repeticiones, series y días de entrenamiento.',
    metrics: ['nl', 'sets', 'frequency', 'nl_ratio'],
    blockView: true,
  },
  {
    id: 'carga',
    title: 'Carga',
    hint: 'Kilos movidos e intensidad relativa a la referencia.',
    metrics: ['tonnage', 'intensity_simple', 'intensity_by_reps'],
    blockView: true,
  },
  {
    id: 'estres',
    title: 'Estrés (SI)',
    hint: 'Stress Index del modelo doble. No se compara con otros modelos de SI.',
    metrics: ['si_total', 'si_central', 'si_peripheral'],
    blockView: true,
    showAll: true,
  },
  {
    id: 'esfuerzo',
    title: 'Esfuerzo',
    hint: 'RPE medio y desvío entre el RPE real y el objetivo.',
    metrics: ['rpe_mean', 'rpe_dev'],
    blockView: true,
  },
  {
    id: 'cumplimiento',
    title: 'Cumplimiento',
    hint: 'Series hechas sobre las previstas. Sin registro no es omitida.',
    metrics: ['compliance_sets'],
    blockView: true,
  },
  {
    id: 'fatiga',
    title: 'Fatiga',
    hint: 'Fatiga que el atleta reporta al terminar la sesión.',
    metrics: ['fatigue_end'],
    blockView: false,
  },
];

/** Magnitudes que viven en tarjetas propias (fuerza, distribución, bloques). */
export const FUERZA_METRICS = ['e1rm'];
