import type { Status } from './types.js';

/**
 * Prioridad (menor = más prioritaria), rules.md §3:
 * bloqueos y revisión → datos insuficientes → candidato PR / ventana → progresión de carga → progreso sostenido → experimentos de volumen/frecuencia.
 */
export const RANK: Record<Status | 'posible_fin_respuesta_esfuerzo', number> = {
  revision_coach: 1,
  posible_fin_respuesta_esfuerzo: 2,
  posible_fin_respuesta: 3,
  datos_insuficientes: 4,
  candidato_pr: 5,
  oportunidad_pendiente: 6,
  ventana_expresion: 7,
  margen_carga: 8,
  progreso_sostenido: 9,
  tendencia_inicial_favorable: 10,
  estabilidad_observada: 11,
  candidato_volumen: 12,
  candidato_frecuencia: 13,
  sin_senal: 14,
};

/** Estados "ofensivos": proponen hacer más. Si hay varios plausibles se muestran como alternativas a revisar, no como órdenes. */
export const OFFENSIVE: readonly string[] = [
  'candidato_pr',
  'ventana_expresion',
  'margen_carga',
  'candidato_volumen',
  'candidato_frecuencia',
];
