import type { InstanceData } from '@coaching/contracts';
import { currentInstance } from './environment';
export async function guardInstanceWrite() {
  const r = await fetch('/api/instance');
  if (!r.ok) throw new Error('No se pudo verificar la instancia. No se enviaron cambios.');
  const data = (await r.json()) as InstanceData;
  if (
    !currentInstance() ||
    data.mode === 'unspecified' ||
    data.mode !== currentInstance()?.mode ||
    (data.mode === 'laboratory' && data.fictitious !== true) ||
    data.datasetId !== currentInstance()?.datasetId
  )
    throw new Error(
      'La instancia cambió o no está identificada. No se enviaron cambios; recargá para verificarla.',
    );
}

export const guardLaboratoryWrite = guardInstanceWrite;
