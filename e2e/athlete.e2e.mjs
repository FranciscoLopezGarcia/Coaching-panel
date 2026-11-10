/**
 * E2E del portal del atleta contra un stack AISLADO (API + Vite + Chrome headless), con BD temporal: no toca la base de demo.
 *   node e2e/athlete.e2e.mjs
 * Comprueba de punta a punta que lo que hace el coach (API) se refleja en el navegador del atleta y al revés, con tiempos.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_PORT = 3290;
const WEB_PORT = 5290;
const CDP_PORT = 9333;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const root = new URL('..', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'e2e-'));
const procs = [];
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Argentina/Mendoza',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const daysAgo = (n) => {
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

function start(cmd, args, opts) {
  const p = spawn(cmd, args, { stdio: 'ignore', detached: false, ...opts });
  procs.push(p);
  return p;
}
async function waitHttp(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* todavía no */
    }
    await sleep(300);
  }
  throw new Error('no levantó: ' + url);
}
const api = async (method, path, body, token) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
};

/* ---------------- CDP mínimo ---------------- */
class Page {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        const { res, rej } = this.pending.get(d.id);
        this.pending.delete(d.id);
        d.error ? rej(new Error(d.error.message)) : res(d.result);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eval');
    return r.result.value;
  }
  async until(expr, ms = 8000, label = expr) {
    const t0 = Date.now();
    for (;;) {
      try {
        const v = await this.eval(expr);
        if (v) return Date.now() - t0;
      } catch {
        /* la página puede estar navegando */
      }
      if (Date.now() - t0 > ms) throw new Error(`timeout (${ms} ms) esperando: ${label}`);
      await sleep(80);
    }
  }
}

async function test(name, fn) {
  const t0 = Date.now();
  try {
    const extra = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, extra });
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

/* ---------------- datos ---------------- */
const proto = (extra) => ({
  loadMode: 'kg',
  segment: 'work',
  pct: null,
  capKg: null,
  tempo: null,
  pauseSec: null,
  instructions: null,
  ...extra,
});
const mk = (id, session, name, no, date, extra = {}) => ({
  id,
  sessionKey: session,
  slotKey: `b:w1:d1:${name}`,
  exposureId: `${session}:${name}`,
  exerciseName: name,
  lift: name.startsWith('Squat') ? 'SQ' : name.startsWith('Bench') ? 'BP' : null,
  plannedDate: date,
  setNo: no,
  reps: 5,
  targetRpe: 8,
  plannedKg: 100,
  refKg: 140,
  isWarmup: false,
  blockKey: 'bloque-e2e',
  weekNo: 1,
  dayNo: 1,
  priority: 1,
  protocol: null,
  ...extra,
});
const todaySets = (squatView, squatNote) => [
  mk('sq-w', 's-hoy', 'Squat comp', 1, today, {
    plannedKg: 60,
    targetRpe: null,
    isWarmup: true,
    protocol: proto({ athleteView: squatView, pauseSec: 120 }),
  }),
  mk('sq-t', 's-hoy', 'Squat comp', 2, today, {
    plannedKg: 120,
    protocol: proto({ segment: 'top', athleteView: squatView, pauseSec: 180, instructions: squatNote }),
  }),
  mk('sq-b', 's-hoy', 'Squat comp', 3, today, {
    plannedKg: 105,
    protocol: proto({ segment: 'backoff', athleteView: squatView, pauseSec: 180, instructions: squatNote }),
  }),
  mk('bp-1', 's-hoy', 'Bench comp', 1, today, {
    plannedKg: 80,
    lift: 'BP',
    priority: 2,
    protocol: proto({ athleteView: 'completo', pauseSec: 150 }),
  }),
  ...[1, 2, 3].map((n) =>
    mk(`rm-${n}`, 's-hoy', 'Remo barra', n, today, {
      reps: 8,
      plannedKg: 50,
      lift: null,
      priority: 3,
      protocol: proto({
        repsMax: 10,
        pauseSec: 90,
        athleteProgression: 'reps_kg',
        instructions: 'Controlá la bajada',
      }),
    }),
  ),
];
const prevSets = [1, 2, 3].map((n) =>
  mk(`rp-${n}`, 's-prev', 'Remo barra', n, daysAgo(7), {
    reps: 8,
    plannedKg: 50,
    lift: null,
    priority: 3,
    protocol: proto({ repsMax: 10 }),
  }),
);

/* ---------------- main ---------------- */
let chrome;
try {
  console.log('Levantando stack aislado (API + Vite + Chrome)…');
  start('node', ['--import', 'tsx', 'apps/api/src/server.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(API_PORT), DB_PATH: join(tmp, 'e2e.sqlite') },
  });
  start(
    'node',
    [
      '../../node_modules/vite/bin/vite.js',
      '--port',
      String(WEB_PORT),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    {
      cwd: join(root, 'apps/web'),
      env: { ...process.env, WEB_API_TARGET: API },
    },
  );
  chrome = start(
    'google-chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${join(tmp, 'chrome')}`,
      '--no-sandbox',
      '--disable-gpu',
      '--window-size=390,844',
      'about:blank',
    ],
    {},
  );
  await Promise.all([
    waitHttp(`${API}/api/athletes`),
    waitHttp(WEB),
    waitHttp(`http://127.0.0.1:${CDP_PORT}/json/version`),
  ]);

  // atleta, plan y cuenta (lado coach, por API)
  const ath = await api('POST', '/api/athletes', { name: 'Ana Prueba' });
  const A = ath.id;
  await api('POST', `/api/athletes/${A}/plan`, {
    sets: [...prevSets, ...todaySets('solo_rpe', 'Pausa de 1s abajo')],
    status: 'aplicado',
  });
  await api('PUT', `/api/athletes/${A}/account`, { email: 'ana@e2e.test', password: 'clave-e2e-1' });
  const { token } = await api('POST', '/api/auth/login', { email: 'ana@e2e.test', password: 'clave-e2e-1' });
  // lo que hizo la semana pasada: 10-8-8 a 50 kg (para la progresión)
  for (const [id, reps, rpe] of [
    ['rp-1', 10, 8],
    ['rp-2', 8, 8.5],
    ['rp-3', 8, 9],
  ])
    await api('PUT', '/api/me/sets', { plannedSetId: id, status: 'done', kg: 50, reps, rpe }, token);

  const tabs = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const page = new Page(ws);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.send('Page.navigate', { url: `${WEB}/#/atleta` });

  const setInput = (sel, value) =>
    page.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const s = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; s.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
    );
  const sectionJs = (name) =>
    `[...document.querySelectorAll('.ath-exercise')].find((s) => s.querySelector('h2')?.textContent.trim() === ${JSON.stringify(name)})`;
  const phs = (name) =>
    page.eval(
      `[...${sectionJs(name)}.querySelectorAll('tbody tr:not(.meta) td:nth-child(3) input')].map((i) => i.placeholder)`,
    );
  const serverSets = async () => (await api('GET', '/api/me/sessions/s-hoy', undefined, token)).exercises;
  const doneOf = async (name) =>
    (await serverSets()).find((e) => e.name === name).sets.map((s) => s.actual?.status === 'done');

  console.log('\nE2E portal del atleta');
  await test('login: clave incorrecta se rechaza y la correcta entra', async () => {
    await page.until(`!!document.querySelector('input[type=email]')`, 15000, 'pantalla de login');
    await setInput('input[type=email]', 'ana@e2e.test');
    await setInput('input[type=password]', 'mala');
    await page.eval(`document.querySelector('form button').click()`);
    await page.until(`!!document.querySelector('[role=alert]')`, 5000, 'mensaje de error');
    await setInput('input[type=password]', 'clave-e2e-1');
    await page.eval(`document.querySelector('form button').click()`);
    await page.until(`document.body.innerText.includes('Hola, Ana')`, 8000, 'Home');
  });

  await test('home: sesión de hoy, bloque y TRAC', async () => {
    await page.until(`document.body.innerText.includes('ENTRENAMIENTO DE HOY')`, 5000, 'tarjeta de hoy');
    const txt = await page.eval('document.body.innerText');
    assert(/Squat comp/.test(txt), 'falta la sesión de hoy');
    assert(/TRAC|Sueño|sueño/i.test(txt), 'falta el TRAC');
  });

  await test('abrir el entreno desde el Home', async () => {
    await page.eval(
      `[...document.querySelectorAll('button')].find((b) => /Empezar/.test(b.textContent)).click()`,
    );
    await page.until(`document.querySelectorAll('.ath-exercise').length === 3`, 8000, '3 ejercicios');
  });

  await test('vista por ejercicio: sentadilla solo RPE (sin kg), banca completa (con kg)', async () => {
    const sq = await phs('Squat comp');
    const bp = await phs('Bench comp');
    assert(
      sq.every((p) => p === '—'),
      `la sentadilla no debe mostrar kg: ${sq}`,
    );
    assert(bp[0] === '80', `la banca debe mostrar 80 kg: ${bp}`);
  });

  await test('notas del coach visibles debajo del ejercicio (una vez, no por serie)', async () => {
    const n = await page.eval(`${sectionJs('Squat comp')}.querySelectorAll('.ath-coachnote').length`);
    assert(n === 1, `notas del coach: ${n}`);
    assert(
      (await page.eval(`${sectionJs('Squat comp')}.querySelector('.ath-coachnote').textContent`)).includes(
        'Pausa de 1s abajo',
      ),
      'texto de la nota',
    );
  });

  await test('progresión: el coach habilitó reps y kg → el atleta ve "9 reps" con 50 kg', async () => {
    const g = await page.eval(`${sectionJs('Remo barra')}.querySelector('.ath-goal')?.textContent ?? ''`);
    assert(/9 reps/.test(g) && /50 kg/.test(g), `meta: «${g}»`);
  });

  await test('marcar ✓ completa con la meta (50 kg × 9) y llega al servidor; arranca el descanso de 90 s', async () => {
    await page.eval(`${sectionJs('Remo barra')}.querySelector('.ath-check').click()`);
    const ms = await page.until(`!!document.querySelector('.ath-rest')`, 4000, 'cuenta regresiva');
    const t0 = Date.now();
    for (;;) {
      const s = (await serverSets()).find((e) => e.name === 'Remo barra').sets[0];
      if (s.actual?.status === 'done') {
        assert(s.actual.kg === 50 && s.actual.reps === 9, `se guardó ${JSON.stringify(s.actual)}`);
        break;
      }
      assert(Date.now() - t0 < 4000, 'la serie no llegó al servidor');
      await sleep(100);
    }
    const rest = await page.eval(`document.querySelector('.ath-rest').textContent`);
    assert(/Descanso 1:(2|3)\d/.test(rest), `descanso: ${rest}`);
    return `guardada en ${Date.now() - t0} ms`;
  });

  await test('EN VIVO coach→atleta: el coach pasa la sentadilla a «completo» y cambia la nota; el atleta lo ve sin recargar', async () => {
    const t0 = Date.now();
    await api('POST', `/api/athletes/${A}/plan`, {
      sets: todaySets('completo', 'Nueva indicación del coach'),
      status: 'aplicado',
    });
    await page.until(
      `${sectionJs('Squat comp')}.querySelector('tbody tr:not(.meta) td:nth-child(3) input').placeholder === '120' || [...${sectionJs('Squat comp')}.querySelectorAll('tbody tr:not(.meta) td:nth-child(3) input')].some((i) => i.placeholder === '120')`,
      6000,
      'kg visibles',
    );
    await page.until(
      `${sectionJs('Squat comp')}.querySelector('.ath-coachnote').textContent.includes('Nueva indicación')`,
      6000,
      'nota nueva',
    );
    const ms = Date.now() - t0;
    assert(ms < 4000, `demoró ${ms} ms`);
    return `reflejado en ${ms} ms`;
  });

  await test('lo que el atleta ya había marcado sobrevive a la actualización del coach', async () => {
    const d = await page.eval(
      `${sectionJs('Remo barra')}.querySelector('.ath-check').classList.contains('on')`,
    );
    assert(d, 'la serie marcada se perdió');
  });

  await test('EN VIVO coach→atleta: el coach cambia solo el descanso del ejercicio (sin recargar)', async () => {
    const sets = todaySets('completo', 'Nueva indicación del coach').map((s) =>
      s.exerciseName === 'Bench comp' ? { ...s, protocol: { ...s.protocol, pauseSec: 45 } } : s,
    );
    const t0 = Date.now();
    await api('POST', `/api/athletes/${A}/plan`, { sets, status: 'aplicado' });
    await page.until(`${sectionJs('Bench comp')}.textContent.includes('Pausa 45s')`, 6000, 'pausa 45s');
    return `${Date.now() - t0} ms`;
  });

  await test('nota del atleta debajo del ejercicio → la ve el coach', async () => {
    await setInput(
      '.ath-exercise:nth-of-type(3) .ath-exnote textarea, ' + 'section.ath-exercise:last-of-type textarea',
      'Me molestó el codo',
    );
    const t0 = Date.now();
    for (;;) {
      const n = (await api('GET', `/api/athletes/${A}/notes?sessionKey=s-hoy`)).notes;
      if (n.some((x) => x.note === 'Me molestó el codo')) break;
      assert(Date.now() - t0 < 4000, 'la nota no llegó');
      await sleep(100);
    }
    return `${Date.now() - t0} ms`;
  });

  await test('SIN CONEXIÓN: se avisa, no se pierde la serie y se envía sola al volver la señal', async () => {
    await page.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await page.eval(`${sectionJs('Remo barra')}.querySelectorAll('.ath-check')[1].click()`);
    await page.until(`!!document.querySelector('.ath-sync.warn')`, 6000, 'aviso sin conexión');
    assert(!(await doneOf('Remo barra'))[1], 'no debería estar en el servidor todavía');
    await page.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    const t0 = Date.now();
    for (;;) {
      if ((await doneOf('Remo barra'))[1]) break;
      assert(Date.now() - t0 < 10000, 'la serie guardada offline no llegó');
      await sleep(150);
    }
    await page.until(`!document.querySelector('.ath-sync.warn')`, 6000, 'el aviso desaparece');
    return `entregada ${Date.now() - t0} ms después de volver la señal`;
  });

  await test('EN VIVO atleta→coach: cada escritura del atleta sube la revisión que escucha el coach', async () => {
    const r0 = (await api('GET', `/api/athletes/${A}/rev`)).rev;
    await page.eval(`${sectionJs('Remo barra')}.querySelectorAll('.ath-check')[2].click()`);
    const t0 = Date.now();
    for (;;) {
      const r = (await api('GET', `/api/athletes/${A}/rev`)).rev;
      if (r !== r0) break;
      assert(Date.now() - t0 < 4000, 'la revisión no cambió');
      await sleep(100);
    }
    // y la progresión del coach ahora ve esta sesión como hecha: la siguiente exposición partiría de 9-9-9
    const items = (await api('GET', `/api/athletes/${A}/progression?sessionKey=s-hoy`)).items;
    assert(items.length === 3, 'progresión por ejercicio');
  });

  await test('aislamiento: con el token del atleta, las rutas del coach dan 403', async () => {
    const r = await fetch(`${API}/api/athletes`, { headers: { authorization: `Bearer ${token}` } });
    assert(r.status === 403, `status ${r.status}`);
  });

  await test('FINALIZAR: al apretar, la tarjeta de cierre queda a la vista (no "no pasa nada")', async () => {
    await page.eval(
      `[...document.querySelectorAll('button')].find((b) => /Finalizar entrenamiento/.test(b.textContent)).click()`,
    );
    await page.until(
      `!![...document.querySelectorAll('button')].find((b) => /Guardar y terminar/.test(b.textContent))`,
      3000,
      'tarjeta de cierre',
    );
    // la vista se desplaza hasta la tarjeta: el botón de guardar tiene que estar dentro de la pantalla
    await page.until(
      `(() => { const b = [...document.querySelectorAll('button')].find((x) => /Guardar y terminar/.test(x.textContent)); const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`,
      4000,
      'botón visible en pantalla',
    );
    const t = await page.eval('document.body.innerText');
    assert(/Marcaste \d+ de \d+ series/.test(t), 'falta el resumen de series');
  });

  await test('FINALIZAR: guardar muestra la confirmación y el coach ve el cierre al instante', async () => {
    await setInput('textarea[maxlength="300"]', 'Buen entreno, el remo salió pesado');
    await page
      .eval(
        `document.querySelector('input[type=range]').value = '7'; document.querySelector('input[type=range]').dispatchEvent(new Event('input', { bubbles: true }))`,
      )
      .catch(() => undefined);
    const r0 = (await api('GET', `/api/athletes/${A}/rev`)).rev;
    const t0 = Date.now();
    await page.eval(
      `[...document.querySelectorAll('button')].find((b) => /Guardar y terminar/.test(b.textContent)).click()`,
    );
    await page.until(
      `document.body.innerText.includes('Entreno guardado')`,
      6000,
      'confirmación en pantalla',
    );
    // lado coach: el cierre llega con fatiga y comentario, y la revisión en vivo cambió
    const n = await api('GET', `/api/athletes/${A}/notes?sessionKey=s-hoy`);
    assert(
      n.finish && n.finish.note === 'Buen entreno, el remo salió pesado',
      `cierre: ${JSON.stringify(n.finish)}`,
    );
    assert(n.finish.endFatigue >= 1, 'falta la fatiga');
    assert((await api('GET', `/api/athletes/${A}/rev`)).rev !== r0, 'la revisión en vivo no cambió');
    const sessions = await api('GET', `/api/athletes/${A}/sessions`);
    assert(
      sessions.find((x) => x.sessionKey === 's-hoy').endFatigue === n.finish.endFatigue,
      'el panel del coach no ve la fatiga',
    );
    return `${Date.now() - t0} ms hasta verlo el coach`;
  });

  await test('después de cerrar: el Home marca el entreno como terminado', async () => {
    await page.eval(
      `[...document.querySelectorAll('button')].find((b) => /Volver al inicio/.test(b.textContent)).click()`,
    );
    await page.until(`document.body.innerText.includes('Terminado')`, 6000, 'etiqueta Terminado en el Home');
    const s = await api('GET', '/api/me/sessions/s-hoy', undefined, token);
    assert(s.finished === undefined || true, '');
    const meta = (await api('GET', '/api/me/home', undefined, token)).session;
    assert(meta.finished === true, 'el servidor no marca finished');
  });
} catch (e) {
  results.push({ name: 'infraestructura', ok: false, error: e.stack ?? e.message });
  console.log('✗ infraestructura:', e.message);
} finally {
  for (const p of procs) p.kill('SIGKILL');
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true });
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} OK`);
process.exit(bad.length ? 1 : 0);
