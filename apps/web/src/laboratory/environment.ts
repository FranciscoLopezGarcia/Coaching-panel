import type { InstanceData } from '@coaching/contracts';
export const expectsLaboratory = import.meta.env.VITE_BASE_MODE === 'laboratory';
export let laboratory = false;
export let instanceLabel = 'Verificando instancia…';
let instance: InstanceData | null = null;
export const currentInstance = () => instance;
export function configureInstance(data: InstanceData) {
  if (expectsLaboratory && (data.mode !== 'laboratory' || data.fictitious !== true))
    throw new Error(
      'Esta URL está reservada al laboratorio, pero la API no se identifica como laboratorio ficticio. No se habilitaron escrituras.',
    );
  instance = data;
  laboratory = data.mode === 'laboratory' && data.fictitious === true;
  instanceLabel = laboratory
    ? 'Laboratorio · datos ficticios'
    : data.mode === 'personal'
      ? 'Instancia personal · datos del coach'
      : 'Instancia sin clasificar · solo lectura hasta identificar el origen';
}
export function athleteName(name: string) {
  return laboratory && !/ficticio|sint[eé]tico/i.test(name) ? `Ficticio · ${name.trim()}` : name.trim();
}
