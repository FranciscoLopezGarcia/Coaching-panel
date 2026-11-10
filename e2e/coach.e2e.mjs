/**
 * E2E del portal del atleta contra un stack AISLADO (API + Vite + Chrome headless), con BD temporal: no toca la base de demo.
 *   node e2e/athlete.e2e.mjs
 * Comprueba de punta a punta que lo que hace el coach (API) se refleja en el navegador del atleta y al revés, con tiempos.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const mk = (id, block, session, date) => ({
  id,
  sessionKey: session,
  slotKey: `${block}:${session}`,
  exposureId: `${session}:Squat`,
  exerciseName: 'Squat comp',
  lift: 'SQ',
  plannedDate: date,
  setNo: 1,
  reps: 5,
  targetRpe: 8,
  plannedKg: 100,
  refKg: 140,
  isWarmup: false,
  blockKey: block,
  weekNo: 1,
  dayNo: 1,
  priority: 1,
  protocol: null,
});

let chrome;
try {
  console.log('Levantando stack aislado (API + Vite + Chrome)…');
  start('node', ['--import', 'tsx', 'apps/api/src/server.ts'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      DB_PATH: join(tmp, 'e2e.sqlite'),
      INSTANCE_MODE: 'personal',
    },
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

  const mkAthlete = async (name) => {
    const a = (await api('POST', '/api/athletes', { name })).id;
    await api('POST', `/api/athletes/${a}/plan`, {
      sets: [
        mk('x1', 'b-uno', 'k1', '2026-10-01'),
        mk('x2', 'b-uno', 'k2', '2026-10-03'),
        mk('x3', 'b-dos', 'k3', '2026-11-12'),
      ],
      status: 'aplicado',
    });
    await api('PUT', `/api/athletes/${a}/mesos`, {
      blockKey: 'b-uno',
      name: 'Bloque Uno',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
    });
    await api('PUT', `/api/athletes/${a}/mesos`, {
      blockKey: 'b-dos',
      name: 'Bloque Dos',
      startDate: '2026-11-09',
      endDate: '2026-11-15',
    });
    return a;
  };
  const A = await mkAthlete('Ana Editable');
  const B = await mkAthlete('Beto Descartable');
  const C = await mkAthlete('Carla Intacta');
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

  const shot = async (name) => {
    if (!process.env.SHOT_DIR) return;
    const r = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.env.SHOT_DIR, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const click = (re) =>
    page.eval(
      `[...document.querySelectorAll('button')].find((b) => ${re}.test(b.textContent))?.click() ?? false`,
    );
  const hasBtn = (re) => `!![...document.querySelectorAll('button')].find((b) => ${re}.test(b.textContent))`;
  const setInput = (sel, value) =>
    page.eval(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); const s = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; s.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
    );
  const names = async () => (await api('GET', '/api/athletes')).map((x) => x.name).sort();
  const sessionsOf = async (id) => (await api('GET', `/api/athletes/${id}/sessions`)).map((x) => x.blockKey);

  console.log('\nE2E panel del coach · editar y eliminar');
  await test('abrir el perfil del atleta: están los botones Editar perfil y Eliminar atleta', async () => {
    await page.send('Page.navigate', { url: `${WEB}/#/athlete/${A}` });
    await page.until(hasBtn(/Editar perfil/), 20000, 'botón Editar perfil');
    assert(await page.eval(hasBtn(/Eliminar atleta/)), 'falta Eliminar atleta');
    await sleep(500);
    await shot('1-perfil');
  });

  await test('EDITAR: cambiar nombre y ejercicio de competencia se guarda y se ve en el perfil', async () => {
    await click(/Editar perfil/);
    await page.until(`!!document.querySelector('dialog[open] input[required]')`, 4000, 'diálogo de edición');
    await shot('2-editar');
    await setInput('dialog[open] input[required]', 'Ana Renombrada');
    await click(/Guardar cambios/);
    await page.until(`document.body.innerText.includes('Ana Renombrada')`, 6000, 'nombre nuevo en el perfil');
    const a = await api('GET', `/api/athletes/${A}`);
    assert(a.name === 'Ana Renombrada', `API: ${a.name}`);
  });

  await test('ELIMINAR ATLETA: el botón está bloqueado hasta escribir el nombre exacto', async () => {
    await page.send('Page.navigate', { url: `${WEB}/#/athlete/${B}` });
    await page.until(
      `document.body.innerText.includes('Beto Descartable') && ${hasBtn(/Eliminar atleta/)}`,
      15000,
      'perfil de Beto',
    );
    await sleep(300);
    await click(/Eliminar atleta/);
    await page.until(hasBtn(/Eliminar para siempre/), 4000, 'diálogo');
    await shot('3-eliminar-atleta');
    const disabled = () =>
      page.eval(
        `[...document.querySelectorAll('dialog[open] button')].find((b) => /Eliminar para siempre/.test(b.textContent)).disabled`,
      );
    assert(await disabled(), 'debería estar bloqueado');
    await setInput('dialog[open] input', 'beto');
    assert(await disabled(), 'con nombre parcial debe seguir bloqueado');
    assert((await names()).includes('Beto Descartable'), 'no debió borrarse nada');
  });

  await test('ELIMINAR ATLETA: con el nombre exacto se borra, vuelve al plantel y no se toca a los demás', async () => {
    await setInput('dialog[open] input', 'Beto Descartable');
    await click(/Eliminar para siempre/);
    const t0 = Date.now();
    for (;;) {
      if (!(await names()).includes('Beto Descartable')) break;
      assert(Date.now() - t0 < 6000, 'no se borró');
      await sleep(150);
    }
    assert(await page.eval(`location.hash.startsWith('#/?focus=plantel')`), 'no volvió al plantel');
    const n = await names();
    assert(n.includes('Ana Renombrada') && n.includes('Carla Intacta'), `faltan otros atletas: ${n}`);
    assert((await sessionsOf(C)).length === 3, 'Carla perdió sesiones');
  });

  await test('ELIMINAR BLOQUE: muestra qué se borra y lo elimina; el otro bloque queda', async () => {
    await page.send('Page.navigate', { url: `${WEB}/#/athlete/${C}?tab=plan&block=b-dos` });
    await page.until(hasBtn(/Eliminar bloque/), 20000, 'botón Eliminar bloque');
    await page.until(
      `!document.querySelector('button.danger[disabled]') || ![...document.querySelectorAll('button')].find((b) => /Eliminar bloque/.test(b.textContent)).disabled`,
      6000,
      'botón habilitado',
    );
    await click(/Eliminar bloque/);
    await page.until(`document.body.innerText.includes('Se elimina el bloque')`, 5000, 'vista previa');
    await shot('4-eliminar-bloque');
    const t = await page.eval(`document.querySelector('dialog[open]').innerText`);
    assert(/Bloque Dos/.test(t) && /1 sesión/.test(t), `vista previa: ${t}`);
    await page.eval(
      `[...document.querySelectorAll('dialog[open] button')].filter((b) => /Eliminar bloque/.test(b.textContent)).pop().click()`,
    );
    const t0 = Date.now();
    for (;;) {
      if (!(await sessionsOf(C)).includes('b-dos')) break;
      assert(Date.now() - t0 < 6000, 'el bloque no se borró');
      await sleep(150);
    }
    assert((await sessionsOf(C)).filter((k) => k === 'b-uno').length === 2, 'se tocó el otro bloque');
  });

  await test('ELIMINAR BLOQUE con ejecución: exige tildar la confirmación', async () => {
    await api('POST', `/api/athletes/${C}/sets`, {
      sets: [
        {
          plannedSetId: 'x1',
          status: 'done',
          kg: 100,
          reps: 5,
          rpe: 8,
          performedOn: '2026-10-01',
          pain: null,
        },
      ],
    });
    await page.send('Page.navigate', { url: `${WEB}/#/athlete/${C}?tab=plan&block=b-uno` });
    await page.until(
      `${hasBtn(/Eliminar bloque/)} && ![...document.querySelectorAll('button')].find((b) => /Eliminar bloque/.test(b.textContent)).disabled`,
      25000,
      'botón Eliminar bloque habilitado',
    );
    await sleep(800);
    await click(/Eliminar bloque/);
    await page.until(`document.body.innerText.includes('ya registrada')`, 5000, 'aviso de ejecución');
    await shot('5-bloque-con-ejecucion');
    const btn = `[...document.querySelectorAll('dialog[open] button')].filter((b) => /Eliminar bloque/.test(b.textContent)).pop()`;
    assert(await page.eval(`${btn}.disabled`), 'debería estar bloqueado hasta tildar');
    await page.eval(`document.querySelector('dialog[open] input[type=checkbox]').click()`);
    assert(!(await page.eval(`${btn}.disabled`)), 'tildado debería habilitarse');
    await page.eval(`${btn}.click()`);
    const t0 = Date.now();
    for (;;) {
      if (!(await sessionsOf(C)).includes('b-uno')) break;
      assert(Date.now() - t0 < 6000, 'el bloque no se borró');
      await sleep(150);
    }
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
