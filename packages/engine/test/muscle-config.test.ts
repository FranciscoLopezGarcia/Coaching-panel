import { describe, expect, it } from 'vitest';
import { musclesForSet, muscleMapKey, type MuscleConfig } from '../src/muscles.js';

const sq = { exerciseId: 'squat-comp', exerciseName: 'Sentadilla competencia' };

describe('Músculos · granularidad y mapa propio', () => {
  it('vista fina = la convención de siempre', () => {
    const f = musclesForSet(sq, { view: 'fino' })!;
    expect(f.find((m) => m.group === 'cuadriceps')?.kind).toBe('directo');
    expect(f.find((m) => m.group === 'isquiotibiales')?.kind).toBe('indirecto');
  });
  it('vista media agrupa sin duplicar: una serie cuenta UNA vez por grupo agrupado', () => {
    const m = musclesForSet({ exerciseId: 'row', exerciseName: 'Remo con barra' }, { view: 'medio' })!;
    const espalda = m.filter((x) => x.group === ('espalda' as never));
    expect(espalda).toHaveLength(1);
    expect(espalda[0]!.kind).toBe('directo'); // dorsales y espalda alta directos
  });
  it('el mapa propio del atleta gana sobre la convención (DL convencional más isquio)', () => {
    const cfg: MuscleConfig = {
      map: {
        [muscleMapKey('Peso muerto competencia')]: { direct: ['isquiotibiales'], indirect: ['gluteos'] },
      },
    };
    const m = musclesForSet({ exerciseId: 'deadlift-comp', exerciseName: 'Peso muerto competencia' }, cfg)!;
    expect(m.map((x) => `${x.group}:${x.kind}`).sort()).toEqual([
      'gluteos:indirecto',
      'isquiotibiales:directo',
    ]);
    // otro ejercicio no cambia
    expect(musclesForSet(sq, cfg)!.some((x) => x.group === 'cuadriceps')).toBe(true);
  });
  it('un ejercicio sin mapa y sin regla sigue sin músculos (no se adivina)', () => {
    expect(musclesForSet({ exerciseId: 'zzz', exerciseName: 'Zzz raro' }, { view: 'grueso' })).toBeNull();
  });
});

describe('Músculos · nombres en español', () => {
  const ex = (name: string) => musclesForSet({ exerciseId: name, exerciseName: name });
  it.each([
    ['Sentadilla competencia', 'cuadriceps'],
    ['Sentadilla pausa', 'cuadriceps'],
    ['Peso muerto competencia', 'isquiotibiales'],
    ['Peso muerto rumano', 'isquiotibiales'],
    ['Remo con barra', 'dorsales'],
    ['Prensa de piernas', 'cuadriceps'],
    ['Curl femoral', 'isquiotibiales'],
    ['Elevaciones laterales', 'hombros'],
    ['Jalón al pecho', 'dorsales'],
    ['Banca competencia', 'pectoral'],
  ])('%s aporta directo a %s', (name, muscle) => {
    const m = ex(name);
    expect(m, name).not.toBeNull();
    expect(m!.find((x) => x.group === muscle)?.kind).toBe('directo');
  });
});
