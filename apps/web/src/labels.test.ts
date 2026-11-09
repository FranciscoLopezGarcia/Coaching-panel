import { describe, expect, it } from 'vitest';
import { fmt, statusInfo } from './labels';

describe('statusInfo', () => {
  it('un estado faltante o desconocido no se pinta como verde', () => {
    expect(statusInfo(null).tone).toBe('muted');
    expect(statusInfo('algo_raro').tone).toBe('muted');
    expect(statusInfo(undefined).label).toBe('Sin evaluar');
  });
  it('revisión del coach es el tono más alto', () => {
    expect(statusInfo('revision_coach').tone).toBe('bad');
  });
  it('los estados nuevos están nombrados y nunca caen en verde por defecto', () => {
    expect(statusInfo('candidato_pr').label).toBe('Candidato a PR');
    expect(statusInfo('ventana_expresion').tone).toBe('ok');
  });
  it('formatea con coma decimal y un guion cuando falta el dato (nunca 0)', () => {
    expect(fmt(1.25)).toBe('1,3');
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
  });
});
