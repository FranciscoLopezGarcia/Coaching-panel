import type { RecordRef } from './metric-result.js';

/**
 * Origen de cada evidencia. Evidencias del MISMO origen derivadas de las MISMAS series no son confirmaciones independientes:
 * e1RM, Fatigue Ratio y tendencia calculados con las mismas series cuentan como UN grupo de evidencia.
 */
export type EvidenceOrigin =
  'rendimiento' | 'carga' | 'cuestionario' | 'cumplimiento' | 'observacion_tecnica';

export interface EvidenceItem {
  id: string;
  origin: EvidenceOrigin;
  label: string;
  value: string | number | null;
  unit?: string;
  /** Registros que sustentan la evidencia (para abrirlos). */
  refs: RecordRef[];
  /** Fuentes de las que deriva (p. ej. `series:squat-primaria`). Dos ítems con una fuente común son dependientes. */
  derivedFrom: string[];
  /** Ítems del mismo grupo cuentan como UNA confirmación. */
  independenceGroup: string;
  /** Si el dato está desactualizado respecto del corte (p. ej. check-in vencido). */
  stale?: boolean;
}

export interface EvidenceDependency {
  a: string;
  b: string;
  reason: string;
}

/** Evaluación explicable de la evidencia. NO es una probabilidad ni un porcentaje: son tres dimensiones separadas. */
export type Sufficiency = 'suficiente' | 'parcial' | 'insuficiente';
export type Recency = 'vigente' | 'desactualizada' | 'desconocida';
export type Comparability = 'comparable' | 'parcial' | 'no_comparable' | 'desconocida';

export interface EvidenceAssessment {
  /** ¿Hay datos suficientes para sostener la lectura? */
  sufficiency: Sufficiency;
  /** ¿Los datos son recientes respecto del corte? */
  recency: Recency;
  /** ¿Las exposiciones usadas son comparables entre sí (misma variante, protocolo y referencia)? */
  comparability: Comparability;
  /** Cantidad de grupos de evidencia independientes (no de ítems). */
  independentGroups: number;
  items: number;
  correlationNote: string;
  reasons: string[];
}

export interface Fact {
  key: string;
  label: string;
  value: number | string | boolean | null;
  unit?: string;
  /** De dónde sale: una métrica del catálogo, un parámetro o el propio resultado de la regla. */
  source: 'metrica' | 'parametro' | 'regla';
  sourceId?: string;
}

/** Cuenta grupos independientes y describe la dependencia entre ítems. */
export function dependenciesOf(items: EvidenceItem[]): {
  dependencies: EvidenceDependency[];
  groups: number;
} {
  const groups = new Set(items.map((i) => i.independenceGroup));
  const deps: EvidenceDependency[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i] as EvidenceItem;
      const b = items[j] as EvidenceItem;
      const shared = a.derivedFrom.filter((x) => b.derivedFrom.includes(x));
      if (a.independenceGroup === b.independenceGroup || shared.length) {
        deps.push({
          a: a.id,
          b: b.id,
          reason: shared.length
            ? `derivan de las mismas series (${shared.join(', ')})`
            : 'pertenecen al mismo grupo de evidencia',
        });
      }
    }
  }
  return { dependencies: deps, groups: groups.size };
}

export function correlationNote(items: EvidenceItem[]): string {
  const { groups } = dependenciesOf(items);
  if (items.length <= groups)
    return items.length ? 'Las evidencias provienen de fuentes independientes.' : 'Sin evidencias.';
  return `${items.length} evidencias derivan de ${groups} grupo${groups === 1 ? '' : 's'} de datos: las que comparten series cuentan como una sola confirmación, no como varias.`;
}
