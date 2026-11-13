/**
 * Protección de la base de producción. Los scripts que cargan datos de ejemplo o vacían tablas NO deben correr contra una base remota
 * (Turso) por accidente —p. ej. porque el .env local apunta a producción—. Para permitirlo hay que decirlo explícitamente.
 */
export const isRemoteDb = (path: string): boolean => /^(libsql|https?|wss?):/.test(path);

export function refuseOnRemote(path: string, what: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isRemoteDb(path) && env.I_UNDERSTAND_THIS_WRITES_PRODUCTION !== 'yes') {
    console.error(
      `Bloqueado: «${what}» escribiría datos de ejemplo o borraría tablas en una base REMOTA (${path.replace(/\/\/.*@/, '//')}).\n` +
        'Usá una base local (DB_PATH=./data/otra.sqlite). Si de verdad es intencional, antes hacé "npm run db:backup" y repetí con I_UNDERSTAND_THIS_WRITES_PRODUCTION=yes.',
    );
    process.exit(3);
  }
}
