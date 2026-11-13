# Deploy sin tocar los datos

**La base vive fuera del código** (Turso, `COACHING_DB_URL` / `COACHING_DB_TOKEN` en Vercel). Un push/deploy reemplaza solo código: la base queda como está.

Lo único que un deploy ejecuta contra la base, al arrancar en frío (`apps/api/src/vercel.ts`):

1. `runMigrations`: aplica **una sola vez**, en orden y de forma atómica (`BEGIN…COMMIT`) las migraciones nuevas. Si una falla, no se aplica nada y la API no arranca (no queda a medias).
2. `coaches.ensure`: crea el coach inicial solo si no existe.

Salvaguardas:

- `test/migrations-safe.test.ts` rompe el CI si una migración tiene `DROP`, `DELETE FROM`, `TRUNCATE`, `ALTER … DROP/RENAME` o `UPDATE` sin `WHERE`. Solo cambios aditivos.
- `seed` y `db:copy --replace` se niegan a correr contra una base remota (`src/db/guard.ts`) salvo `I_UNDERSTAND_THIS_WRITES_PRODUCTION=yes`.
- Las bases `.sqlite`, `.csv` y `backups/` están en `.gitignore`; el CI falla si se versionan.
- El Analizador de bloques es de **solo lectura** y no agrega migraciones.

Antes de un deploy que incluya una migración nueva:

```
npm run db:backup -w @coaching/api   # JSON local en apps/api/backups/ (solo lectura sobre la base)
```

Para restaurar ante un problema: Turso permite volver a un punto en el tiempo (`turso db create --from-db … --timestamp …`).
