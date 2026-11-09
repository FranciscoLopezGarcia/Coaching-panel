import { existsSync, readFileSync } from 'node:fs';

/**
 * Identificación de la instancia (qué base de datos es): ficticia (laboratorio) o no. Se lee de un archivo junto a la BD
 * (`<bd>.instance.json`, lo escribe `lab:create`) o de INSTANCE_MODE. Sin ninguna de las dos, el modo es "unspecified": el sistema NO deduce
 * si los datos son reales. No requiere migración de base de datos.
 */
export interface InstanceInfo {
  mode: 'laboratory' | 'personal' | 'unspecified';
  fictitious: boolean | null;
  datasetId: string | null;
  label: string | null;
  createdAt: string | null;
  cases: LabCatalogCase[];
}
export interface LabCatalogCase {
  key: string;
  name: string;
  athleteId: string;
  summary: string;
  explores: string;
  objective: string;
  cutoffs: { date: string; note: string }[];
}

export function loadInstance(dbPath: string, env: NodeJS.ProcessEnv = process.env): InstanceInfo {
  const none: InstanceInfo = {
    mode: 'unspecified',
    fictitious: null,
    datasetId: null,
    label: null,
    createdAt: null,
    cases: [],
  };
  const file = `${dbPath}.instance.json`;
  if (dbPath !== ':memory:' && existsSync(file)) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<InstanceInfo>;
      if (j.mode === 'laboratory' || j.mode === 'personal')
        return {
          ...none,
          ...j,
          mode: j.mode,
          fictitious: j.mode === 'laboratory' ? true : (j.fictitious ?? null),
          cases: j.cases ?? [],
        };
    } catch {
      /* archivo ilegible: se ignora, no se deduce nada */
    }
  }
  const m = env.INSTANCE_MODE;
  if (m === 'laboratory' || m === 'personal')
    return {
      ...none,
      mode: m,
      fictitious: m === 'laboratory' ? true : null,
      datasetId: env.INSTANCE_ID ?? null,
      label: env.INSTANCE_LABEL ?? null,
    };
  return none;
}
