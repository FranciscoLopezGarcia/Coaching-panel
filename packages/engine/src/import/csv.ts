/** Lector CSV (RFC 4180): comillas, comillas escapadas, comas y saltos de línea dentro de campos, CRLF y BOM. Sin dependencias. */
export function parseCsv(text: string): string[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] as string;
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** Filas → objetos por encabezado. Devuelve también el número de línea (1 = encabezado) de cada fila. */
export function csvRecords(text: string): {
  headers: string[];
  records: { line: number; data: Record<string, string> }[];
} {
  const rows = parseCsv(text);
  const headers = (rows[0] ?? []).map((h) => h.trim());
  return {
    headers,
    records: rows.slice(1).map((r, i) => ({
      line: i + 2,
      data: Object.fromEntries(headers.map((h, j) => [h, (r[j] ?? '').trim()])),
    })),
  };
}
