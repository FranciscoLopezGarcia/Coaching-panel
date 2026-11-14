export interface Config {
  port: number;
  host: string;
  dbPath: string;
  webOrigin: string;
  timeZone: string;
  tursoToken?: string;
  /** true = la API del coach exige login (producción). */
  coachAuth: boolean;
  /** Coach inicial que se crea si no existe (COACH_EMAIL / COACH_PASSWORD). */
  coachEmail?: string;
  coachPassword?: string;
  /** Entorno sin procesos largos (Vercel): sin SSE, solo sondeo. */
  serverless: boolean;
}

/** Quita espacios y saltos de línea (al pegar una variable larga suelen colarse). */
const squash = (v: string | undefined) => v?.replace(/\s+/g, '').replace(/^["']|["']$/g, '') || undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? '127.0.0.1',
    // Orden: COACHING_DB_URL (producción en Vercel) > DB_PATH explícito > TURSO_DATABASE_URL (.env local) > archivo por defecto.
    // Un DB_PATH explícito gana sobre TURSO_* para que `DB_PATH=./x.sqlite npm run ...` nunca toque producción por culpa del .env.
    dbPath:
      squash(env.COACHING_DB_URL) ??
      env.DB_PATH ??
      squash(env.TURSO_DATABASE_URL) ??
      './data/coaching.sqlite',
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    timeZone: env.TZ_APP ?? 'America/Argentina/Mendoza',
    tursoToken: squash(env.COACHING_DB_URL ? env.COACHING_DB_TOKEN : env.TURSO_AUTH_TOKEN),
    coachAuth: env.COACH_AUTH === 'on',
    coachEmail: env.COACH_EMAIL?.trim().toLowerCase() || undefined,
    coachPassword: env.COACH_PASSWORD || undefined,
    serverless: !!env.VERCEL,
  };
}

/** Fecha civil de hoy (yyyy-mm-dd) en la zona del coach. */
export function todayIso(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
