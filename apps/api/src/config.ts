export interface Config {
  port: number;
  host: string;
  dbPath: string;
  webOrigin: string;
  timeZone: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? '127.0.0.1',
    dbPath: env.DB_PATH ?? './data/coaching.sqlite',
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    timeZone: env.TZ_APP ?? 'America/Argentina/Mendoza',
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
