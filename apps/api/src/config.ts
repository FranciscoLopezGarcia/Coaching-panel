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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? '127.0.0.1',
    dbPath: env.COACHING_DB_URL ?? env.TURSO_DATABASE_URL ?? env.DB_PATH ?? './data/coaching.sqlite',
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    timeZone: env.TZ_APP ?? 'America/Argentina/Mendoza',
    tursoToken: env.COACHING_DB_URL ? env.COACHING_DB_TOKEN : env.TURSO_AUTH_TOKEN,
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
