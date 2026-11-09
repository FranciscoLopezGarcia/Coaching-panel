import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Los paquetes del monorepo se publican como TS: se empaquetan dentro del build.
  noExternal: [/^@coaching\//],
  // Copia las migraciones SQL junto al bundle.
  onSuccess: "node -e \"require('node:fs').cpSync('src/db/migrations','dist/migrations',{recursive:true})\"",
});
