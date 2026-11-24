import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api } from '../api/client';
import { useLoad } from '../hooks';
import type { Annotation } from './OverviewChart';

/** Cambio de plan con fecha de vigencia (lo que entrega la API del analizador de bloques). */
export interface CPlanChange {
  id: string;
  date: string;
  classes: string[];
  estimated: boolean;
}
const CHANGE_LABEL: Record<string, string> = {
  volumen_aumentado: 'Más volumen',
  volumen_disminuido: 'Menos volumen',
  redistribucion_frecuencia: 'Frecuencia',
  cambio_perfil_estimulo: 'Perfil de estímulo',
  cambio_intensidad_esfuerzo: 'Intensidad / esfuerzo',
  mixto: 'Cambio mixto',
  bloque_nuevo: 'Bloque nuevo',
  bloque_retirado: 'Bloque retirado',
};
/** Marcas verticales de los cambios de plan que rigen en el período (los «sin cambios» no se marcan). */
export function planMarks(changes: CPlanChange[] | undefined): Annotation[] {
  return (changes ?? []).flatMap((c) => {
    const names = c.classes
      .filter((k) => !['sin_cambios', 'bloque_nuevo', 'bloque_retirado'].includes(k))
      .map((k) => CHANGE_LABEL[k] ?? k.replace(/_/g, ' '));
    return names.length ? [{ date: c.date, label: names.join(' + '), estimated: c.estimated }] : [];
  });
}

const PlanMarksContext = createContext<Annotation[]>([]);
/** Marcas de cambio de plan del atleta abierto: todo gráfico en el tiempo las dibuja si no recibe las suyas. */
export const usePlanMarks = (): Annotation[] => useContext(PlanMarksContext);

export function PlanMarksProvider({ id, children }: { id: string; children: ReactNode }) {
  const history = useLoad(() => api.history(id), [id]);
  const marks = useMemo(
    () =>
      planMarks(
        (history.data?.events ?? []).flatMap(({ event }) =>
          event.status === 'aplicado' && event.effectiveOn
            ? [
                {
                  id: event.id,
                  date: event.effectiveOn,
                  classes: [...new Set(event.changes.map((c) => c.classification))],
                  estimated: event.effectiveEstimated,
                },
              ]
            : [],
        ),
      ),
    [history.data],
  );
  return <PlanMarksContext.Provider value={marks}>{children}</PlanMarksContext.Provider>;
}
