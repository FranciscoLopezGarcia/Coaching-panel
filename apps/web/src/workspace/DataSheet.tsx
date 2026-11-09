import { useState, type KeyboardEvent } from 'react';
import { pasteCells, type SheetColumn, type CellChange } from './sheetModel';
export function DataSheet({
  label,
  columns,
  rows,
  onChange,
  disabled = false,
}: {
  label: string;
  columns: SheetColumn[];
  rows: Record<string, string>[];
  onChange: (changes: CellChange[]) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState('');
  const move = (e: KeyboardEvent, row: number, col: number) => {
    let r = row,
      c = col;
    if (e.key === 'Enter') r += e.shiftKey ? -1 : 1;
    else if (e.key === 'ArrowUp') r--;
    else if (e.key === 'ArrowDown') r++;
    else if (e.altKey && e.key === 'ArrowLeft') c--;
    else if (e.altKey && e.key === 'ArrowRight') c++;
    else return;
    e.preventDefault();
    const cell = e.currentTarget
      .closest('table')
      ?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-row="${r}"][data-col="${c}"]`);
    cell?.focus();
    if (cell instanceof HTMLInputElement && cell.type === 'text') cell.select();
  };
  return (
    <div className="data-sheet">
      <p className="small muted sheet-hint">
        Tab: siguiente celda · Enter / ↑ ↓: misma columna · Pegá filas y columnas desde Excel.
      </p>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap" tabIndex={0} role="region" aria-label={label}>
        <table aria-label={label}>
          <thead>
            <tr>
              <th scope="col">#</th>
              {columns.map((c) => (
                <th scope="col" key={c.key}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.id ?? r}>
                <th scope="row">{r + 1}</th>
                {columns.map((c, i) => (
                  <td key={c.key} className={c.readOnly ? 'sheet-readonly' : 'sheet-cell'}>
                    {c.readOnly ? (
                      <span title={row[c.key]}>{row[c.key] || '—'}</span>
                    ) : (
                      (() => {
                        const props = {
                          'aria-label': `${c.label} · fila ${r + 1}`,
                          'data-row': r,
                          'data-col': i,
                          disabled,
                          value: row[c.key] ?? '',
                          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
                            setError('');
                            onChange([{ row: r, key: c.key, value: e.target.value }]);
                          },
                          onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) =>
                            move(e, r, i),
                          onPaste: (e: React.ClipboardEvent) => {
                            const text = e.clipboardData.getData('text/plain');
                            if (!/[\t\n]/.test(text)) return;
                            e.preventDefault();
                            try {
                              onChange(pasteCells(text, r, i, rows.length, columns));
                              setError('');
                            } catch (err) {
                              setError((err as Error).message);
                            }
                          },
                        };
                        return c.type === 'select' ? (
                          <select {...props}>
                            {c.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            {...props}
                            type={c.type === 'number' ? 'text' : (c.type ?? 'text')}
                            inputMode={c.type === 'number' ? 'decimal' : undefined}
                            autoComplete="off"
                          />
                        );
                      })()
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">Sin filas en esta selección.</p>}
      </div>
    </div>
  );
}
