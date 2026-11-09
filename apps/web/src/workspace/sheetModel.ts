export interface SheetColumn {
  key: string;
  label: string;
  type?: 'number' | 'text' | 'date' | 'select';
  options?: { value: string; label: string }[];
  readOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
}
export interface CellChange {
  row: number;
  key: string;
  value: string;
}
export function validateCell(value: string, column: SheetColumn): string {
  if (!value) return column.required ? `${column.label}: completá el valor.` : '';
  if (column.type === 'number') {
    const n = Number(value.replace(',', '.'));
    if (
      !Number.isFinite(n) ||
      (column.min !== undefined && n < column.min) ||
      (column.max !== undefined && n > column.max) ||
      (column.step === 1 && !Number.isInteger(n))
    )
      return `${column.label}: valor inválido (${value}).`;
  }
  if (column.type === 'select' && !column.options?.some((o) => o.value === value))
    return `${column.label}: elegí una opción válida.`;
  if (column.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))))
    return `${column.label}: fecha inválida.`;
  return '';
}
/** El pegado es rectangular y se valida íntegro antes de tocar el borrador. */
export function pasteCells(
  text: string,
  row: number,
  col: number,
  rowCount: number,
  columns: SheetColumn[],
): CellChange[] {
  const matrix = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .map((r) => r.split('\t'));
  if (row + matrix.length > rowCount || matrix.some((r) => col + r.length > columns.length))
    throw new Error('El rango pegado excede la planilla. No se modificó ninguna celda.');
  const changes: CellChange[] = [];
  matrix.forEach((cells, dr) =>
    cells.forEach((raw, dc) => {
      const column = columns[col + dc]!;
      if (column.readOnly)
        throw new Error(`${column.label} no es editable. Pegá desde una columna de datos.`);
      let value = raw.trim();
      if (column.type === 'select')
        value =
          column.options?.find(
            (o) => o.label.toLocaleLowerCase() === value.toLocaleLowerCase() || o.value === value,
          )?.value ?? value;
      if (column.type === 'number') value = value.replace(',', '.');
      const error = validateCell(value, column);
      if (error) throw new Error(error + ' No se modificó ninguna celda.');
      changes.push({ row: row + dr, key: column.key, value });
    }),
  );
  return changes;
}
