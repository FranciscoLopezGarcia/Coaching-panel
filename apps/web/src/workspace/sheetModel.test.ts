import { describe, expect, it } from 'vitest';
import { pasteCells, validateCell, type SheetColumn } from './sheetModel';
const cols: SheetColumn[] = [
  { key: 'name', label: 'Serie', readOnly: true },
  { key: 'kg', label: 'Kg', type: 'number', min: 0.01 },
  { key: 'reps', label: 'Reps', type: 'number', min: 1, step: 1 },
  { key: 'rpe', label: 'RPE', type: 'number', min: 1, max: 10 },
  {
    key: 'status',
    label: 'Estado',
    type: 'select',
    options: [
      { value: 'done', label: 'Realizada' },
      { value: 'pending', label: 'Pendiente' },
    ],
  },
];
describe('Pegado de planilla', () => {
  it('pega un rectángulo desde Excel con decimales locales y RPE opcional vacío', () => {
    expect(pasteCells('120,5\t5\t8\n122,5\t4\t\r\n', 0, 1, 2, cols)).toEqual([
      { row: 0, key: 'kg', value: '120.5' },
      { row: 0, key: 'reps', value: '5' },
      { row: 0, key: 'rpe', value: '8' },
      { row: 1, key: 'kg', value: '122.5' },
      { row: 1, key: 'reps', value: '4' },
      { row: 1, key: 'rpe', value: '' },
    ]);
  });
  it('rechaza el rango completo si hay un dato inválido, sin devolver cambios parciales', () => {
    expect(() => pasteCells('120\t5\t8\n125\t4\t11', 0, 1, 2, cols)).toThrow('No se modificó ninguna celda');
    expect(() => pasteCells('120\t4.5', 0, 1, 2, cols)).toThrow('Reps');
  });
  it('no recorta filas excedentes ni permite sobrescribir una columna de contexto', () => {
    expect(() => pasteCells('120\n125\n130', 0, 1, 2, cols)).toThrow('excede');
    expect(() => pasteCells('otra\t120', 0, 0, 2, cols)).toThrow('no es editable');
  });
  it('resuelve etiquetas de estados pero no inventa completado ni RPE', () => {
    expect(pasteCells('Realizada\nPendiente', 0, 4, 2, cols)).toEqual([
      { row: 0, key: 'status', value: 'done' },
      { row: 1, key: 'status', value: 'pending' },
    ]);
    expect(validateCell('', cols[3]!)).toBe('');
    expect(() => pasteCells('Completa\nRealizada', 0, 4, 2, cols)).toThrow('opción válida');
  });
});
