import type { FastifyInstance } from 'fastify';
import { loadTableQuerySchema, prgSiTableQuerySchema } from '@coaching/contracts';
import {
  CORE_VERSION,
  FORMULA_TABLE_VERSION,
  PRG_TABLE_VERSION,
  RPE_CURVE_VERSION,
  SI_TABLE_VERSION,
  efortCurveTable,
  efortXlTable,
  formulaTable,
  DIRECT_WEIGHT,
  INDIRECT_WEIGHT,
  MOVEMENT_PATTERNS,
  MUSCLE_CONVENTION_VERSION,
  MUSCLE_GROUPS,
  MUSCLE_RULE_COUNT,
  PATTERN_CONVENTION_VERSION,
  legacyTableDivergence,
  musclesFor,
  patternFor,
  loadTable,
  prgRpeTable,
  prgSiTable,
  repsAtPct,
  rmTable,
  rpeTableFull,
  rtsSiTable,
} from '@coaching/engine';
import { z } from 'zod';
import { parse } from './http.js';

/** Tablas de referencia (no dependen de ningún atleta): RPE↔%1RM, nRM, cargas, fórmulas de PRG y tablas de SI. Solo lectura. */
export function registerTableRoutes(app: FastifyInstance): void {
  app.get('/api/tables', async () => ({
    versions: {
      rpe: RPE_CURVE_VERSION,
      formulas: FORMULA_TABLE_VERSION,
      prgRpe: PRG_TABLE_VERSION,
      si: SI_TABLE_VERSION,
      core: CORE_VERSION,
    },
    tables: [
      {
        path: '/api/tables/rpe',
        what: '%1RM por reps (1–50) × RPE (1–10, pasos de 0,5); curva única de RTS; origen por celda y comparación con la tabla anterior del proyecto',
      },
      { path: '/api/tables/rm', what: '%1RM para n repeticiones al fallo (nRM), n = 1–50' },
      {
        path: '/api/tables/rm/inverse?pct=',
        what: 'repeticiones al fallo posibles para un %1RM (inversa de la curva)',
      },
      { path: '/api/tables/load?e1rm=&stepKg=', what: 'cargas (kg) para cada reps × RPE dado un e1RM' },
      {
        path: '/api/tables/formulas',
        what: '%1RM por fórmula (Epley, Brzycki, Lander, Lombardi, Mayhew, O’Conner) y promedio de PRG, reps 1–36',
      },
      {
        path: '/api/tables/prg-rpe',
        what: 'tabla RPE×reps de PRG (RPE 0,5–10, reps 1–12) con su diferencia frente a RTS',
      },
      {
        path: '/api/tables/si/rts',
        what: 'SI de RTS (central, periférico, total) reps 1–50 × RPE 1–10; 170 celdas medidas en la app y el resto aproximado',
      },
      { path: '/api/tables/si/efort', what: 'XL de eFort por kg, reps 1–50 × RPE 1–10' },
      { path: '/api/tables/si/efort-curve', what: 'curva continua de eFort (%1RM por h = reps + RIR)' },
      {
        path: '/api/tables/si/prg?pctFrom=&pctTo=&pctStep=&repsMax=',
        what: 'SI de PRG por % de la referencia × reps × RPE',
      },
    ],
    note: 'Los modelos de SI tienen escalas propias y no se comparan entre sí.',
  }));
  app.get('/api/tables/rpe', async () => ({ ...rpeTableFull(), legacyTable: legacyTableDivergence() }));
  app.get('/api/tables/rm', async () => rmTable());
  app.get('/api/tables/rm/inverse', async (req) => {
    const { pct } = parse(z.object({ pct: z.coerce.number().min(1).max(100) }), req.query);
    return {
      pct,
      reps: repsAtPct(pct / 100),
      note: 'Repeticiones al fallo (RPE 10) posibles con ese %1RM; null fuera de la curva (1–50).',
    };
  });
  app.get('/api/tables/load', async (req) => {
    const q = parse(loadTableQuerySchema, req.query);
    return loadTable(q.e1rm, q.stepKg);
  });
  app.get('/api/tables/formulas', async () => formulaTable());
  app.get('/api/tables/prg-rpe', async () => prgRpeTable());
  app.get('/api/tables/si/rts', async () => rtsSiTable());
  app.get('/api/tables/si/efort', async () => efortXlTable());
  app.get('/api/tables/si/efort-curve', async () => efortCurveTable());
  app.get('/api/tables/muscles', async () => ({
    muscles: {
      version: MUSCLE_CONVENTION_VERSION,
      groups: MUSCLE_GROUPS,
      directWeight: DIRECT_WEIGHT,
      indirectWeight: INDIRECT_WEIGHT,
      rules: MUSCLE_RULE_COUNT,
      note: 'Un ejercicio aporta a varios grupos: los grupos se superponen y NO se suman.',
    },
    patterns: {
      version: PATTERN_CONVENTION_VERSION,
      patterns: MOVEMENT_PATTERNS,
      note: 'Cada ejercicio pertenece a UN patrón: series, NL y tonelaje por patrón sí suman.',
    },
  }));
  app.get('/api/tables/muscles/lookup', async (req) => {
    const { exercise } = parse(z.object({ exercise: z.string().min(1).max(200) }), req.query);
    const id = exercise
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return {
      exercise,
      muscles: musclesFor(id, exercise),
      pattern: patternFor(id, exercise),
      mapped: musclesFor(id, exercise) !== null,
    };
  });
  app.get('/api/tables/si/prg', async (req) => prgSiTable(parse(prgSiTableQuerySchema, req.query)));
}
