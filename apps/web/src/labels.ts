import type { Lift } from '@coaching/contracts';

export const LIFT_NAMES: Record<Lift, string> = { SQ: 'Sentadilla', BP: 'Banca', DL: 'Peso muerto' };

export type Tone = 'ok' | 'info' | 'warn' | 'bad' | 'muted';
export interface StatusInfo {
  label: string;
  tone: Tone;
}

/** Estados del motor → texto y tono. Un estado desconocido o faltante NUNCA se pinta como "ok". */
export const STATUS: Record<string, StatusInfo> = {
  revision_coach: { label: 'Revisión del coach', tone: 'bad' },
  posible_fin_respuesta: { label: 'Posible fin de respuesta', tone: 'warn' },
  datos_insuficientes: { label: 'Datos insuficientes', tone: 'muted' },
  candidato_pr: { label: 'Candidato a PR', tone: 'info' },
  oportunidad_pendiente: { label: 'Oportunidad pendiente de evaluación', tone: 'info' },
  estabilidad_observada: { label: 'Estabilidad observada', tone: 'muted' },
  ventana_expresion: { label: 'Ventana de expresión', tone: 'ok' },
  margen_carga: { label: 'Margen para progresar carga', tone: 'info' },
  progreso_sostenido: { label: 'Progreso sostenido', tone: 'ok' },
  tendencia_inicial_favorable: { label: 'Tendencia inicial favorable', tone: 'ok' },
  candidato_volumen: { label: 'Ensayo de volumen', tone: 'info' },
  candidato_frecuencia: { label: 'Redistribuir frecuencia', tone: 'info' },
  sin_senal: { label: 'Sin señal', tone: 'muted' },
};

export const statusInfo = (s: string | null | undefined): StatusInfo =>
  (s && STATUS[s]) || { label: s ?? 'Sin evaluar', tone: 'muted' };

export const RULE_NAMES: Record<string, string> = {
  'B-DOLOR': 'Bloqueo por molestia',
  'R-PROGRESS': 'Progreso (R-PROGRESS)',
  'R-LOAD': 'Margen de carga (R-LOAD)',
  'R-END': 'Fin de respuesta (R-END)',
  'B-TECNICA': 'Bloqueo por técnica no comparable',
  'R-PR': 'Candidato a récord (R-PR)',
  'R-EXPRESSION-A': 'Expresión · modo A (PRG reconstruido)',
  'R-EXPRESSION-B': 'Expresión · modo B (motor propio)',
  'R-VOLUME': 'Ensayo de volumen (R-VOLUME)',
  'R-FREQUENCY': 'Frecuencia (R-FREQUENCY)',
};

export const CLASS_NAMES: Record<string, string> = {
  volumen_aumentado: 'Volumen aumentado',
  volumen_disminuido: 'Volumen disminuido',
  redistribucion_frecuencia: 'Redistribución de frecuencia',
  cambio_perfil_estimulo: 'Cambio de perfil de estímulo',
  cambio_intensidad_esfuerzo: 'Cambio de intensidad/esfuerzo',
  cambio_referencia_modelo: 'Cambio de referencia/modelo',
  cambio_duracion: 'Cambio de duración',
  cambio_ejercicio: 'Cambio de ejercicio/variante',
  bloque_nuevo: 'Bloque nuevo',
  bloque_retirado: 'Bloque retirado',
  mixto: 'Cambio mixto',
};

export const TTP_NAMES: Record<string, string> = {
  delimitado: 'Delimitado',
  no_delimitado: 'No delimitado',
  insuficiente: 'Insuficiente',
  no_concluyente: 'No concluyente',
  censurado: 'Observación censurada',
  en_curso: 'En curso',
};

export const fmt = (x: number | null | undefined, d = 1): string =>
  x === null || x === undefined ? '—' : String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ',');

/** Texto aclaratorio fijo: el sistema informa y propone, el coach decide. */
export const DISCLAIMER =
  'El sistema informa, explica y propone. No modifica la programación ni intenta máximos: la decisión es del coach. Las reglas son una propuesta operativa V0.1, no algoritmos de RTS/PRG ni predicciones validadas.';
