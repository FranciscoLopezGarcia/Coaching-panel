export {};
/**
 * Completa la demo de los 5 atletas: macro de temporada, mesociclos con objetivo, microciclos (semanas) y evaluación al día de hoy.
 * Los mesociclos salen de los bloques del plan (hojas del Excel); los objetivos se deducen del nombre del bloque (supuesto de la demo).
 *   tsx src/seed/completar-demo.ts [--today AAAA-MM-DD]     (con la API corriendo; API_BASE opcional)
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3200/api';
const i = process.argv.indexOf('--today');
const TODAY = i > 0 ? (process.argv[i + 1] as string) : new Date().toISOString().slice(0, 10);
const api = async (m: string, p: string, b?: unknown) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { 'content-type': 'application/json' },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  const t = (await r.json()) as unknown;
  if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(t).slice(0, 400)}`);
  return t;
};
const objective = (k: string) =>
  /pivot|injur|catamarca/.test(k)
    ? 'Pivot / descarga y recuperación'
    : /peak|fast|clasi|taper/.test(k)
      ? 'Peaking: intensidad específica para competir'
      : /nats|nacional|sudamer|meet|prep/.test(k)
        ? 'Preparación específica de competencia'
        : /off|volumen|intro|adapt|new-hope/.test(k)
          ? 'Off-season: volumen y base'
          : 'Desarrollo de fuerza';
const nice = (k: string) => k.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
interface Wk {
  week: { from: string; to: string };
  sessions: number;
}
interface Sess {
  sessionKey: string;
  date: string;
}
const athletes = (await api('GET', '/athletes')) as { id: string; name: string }[];
for (const a of athletes) {
  const core = (await api(
    'GET',
    `/athletes/${a.id}/core?from=2020-01-01&to=2035-12-31&basis=previsto&view=all`,
  )) as { sessions: Sess[]; weeks: Wk[] };
  const by = new Map<string, { from: string; to: string }>();
  for (const s of core.sessions) {
    const k = s.sessionKey.replace(/-w\d+-s\d+$/, '');
    const c = by.get(k);
    if (!c) by.set(k, { from: s.date, to: s.date });
    else {
      if (s.date < c.from) c.from = s.date;
      if (s.date > c.to) c.to = s.date;
    }
  }
  const blocks = [...by.entries()].sort((x, y) => x[1].from.localeCompare(y[1].from));
  const existing = (await api('GET', `/athletes/${a.id}/macros`)) as { name: string }[];
  let macroId: string | undefined;
  if (!existing.some((m) => m.name === 'Temporada (plan del coach)')) {
    const first = blocks[0]?.[1].from as string;
    const last = blocks[blocks.length - 1]?.[1].to as string;
    const m = (await api('POST', `/athletes/${a.id}/macros`, {
      name: 'Temporada (plan del coach)',
      startDate: first,
      endDate: last,
      objective: 'Plan completo cargado desde el Excel del coach',
      status: 'activo',
    })) as { id: string };
    macroId = m.id;
  } else
    macroId = ((await api('GET', `/athletes/${a.id}/macros`)) as { id: string; name: string }[]).find(
      (m) => m.name === 'Temporada (plan del coach)',
    )?.id;
  for (const [k, r] of blocks)
    await api('PUT', `/athletes/${a.id}/mesos`, {
      blockKey: k,
      macroId: macroId ?? null,
      name: nice(k),
      startDate: r.from,
      endDate: r.to,
      objective: objective(k),
    });
  const micro: { blockKey: string; weekNo: number; startDate: string; endDate: string }[] = [];
  for (const [k, r] of blocks) {
    const ws = core.weeks
      .filter((w) => w.sessions > 0 && w.week.to >= r.from && w.week.from <= r.to)
      .sort((x, y) => x.week.from.localeCompare(y.week.from));
    ws.forEach((w, n) =>
      micro.push({ blockKey: k, weekNo: n + 1, startDate: w.week.from, endDate: w.week.to }),
    );
  }
  for (const m of micro) await api('PUT', `/athletes/${a.id}/microcycles`, m);
  await api('POST', `/athletes/${a.id}/evaluate`, { cutoff: TODAY });
  console.log(
    `${a.name}: macro + ${blocks.length} mesociclos + ${micro.length} microciclos + evaluación al ${TODAY}`,
  );
}
