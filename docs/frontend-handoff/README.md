# Handoff de frontend

Para quien construye la interfaz (Codex). El motor, los contratos, la persistencia y la API son del backend; **no hay que reconstruir lógica ni calcular métricas en el cliente**: se consumen. Estética, navegación y UX son libres.

## Orden de lectura

1. Este README → 2. `DOMAIN.md` → 3. `API.md` → 4. `EXAMPLES.md` → 5. `GAPS.md`. Referencias: `docs/REGLAS_Y_PROCEDENCIA.md`, `docs/MIGRACION_Y_COMPATIBILIDAD.md`, y el informe `analisis/features/consolidacion-motor-coaching/outputs/informe-final.md`.

## Requisitos y comandos (reales)

- Node ≥ 22.13 (probado 22.20, usa `node:sqlite` experimental: el aviso `ExperimentalWarning` es normal). npm workspaces.
- Instalar: `npm install --fetch-timeout=180000 --fetch-retries=6` (desde la raíz `app/`).
- API + web: `npm run dev` (ambos) · solo API `npm run dev:api` (http://127.0.0.1:3001) · solo web `npm run dev:web` (http://localhost:5173, proxy `/api` → 3001).
- Calidad: `npm run ci` (format:check, lint, typecheck, test, build). Tests API: `npm test -w @coaching/api`.
- Versiones: TypeScript 5.7, Fastify 5, zod, Vite 5, React 18, vitest 2.

## Variables de entorno (por nombre; ver `.env.example`)

`PORT` (3001) · `HOST` (127.0.0.1) · `DB_PATH` (./data/coaching.sqlite, relativo a apps/api; `:memory:` para pruebas) · `WEB_ORIGIN` (http://localhost:5173, CORS) · `TZ_APP` (America/Argentina/Mendoza). No hay secretos ni autenticación.

## Demo sintética aislada

```bash
npm run seed:synthetic -w @coaching/api -- ./data/demo-sintetica.sqlite   # crea una BD NUEVA; se niega si el archivo ya existe
DB_PATH=./data/demo-sintetica.sqlite npm run dev:api
npm run dev:web
```

Siete atletas 100 % sintéticos: A progresa, B molestia, C datos incompletos, D fatiga intra-sesión, E candidato a récord, F estable, G deterioro (con macro, mesos, 2 versiones de plan en A). El seed **no** toca `coaching.sqlite` ni ninguna BD existente. Las fechas son relativas a hoy. Los estados que muestre son del motor con reglas **[propuesta]**; no son validación predictiva.
Para pruebas HTTP sin servidor: `buildApp(buildContext(cfg, openDb(':memory:'), () => '2026-03-10'))` + `app.inject` (ver `apps/api/test/journeys.test.ts`, que ejecuta los recorridos A–E).

## Cómo trabajar

- Importá tipos y esquemas de `@coaching/contracts`; no dupliques tipos a mano.
- Mostrá siempre `status`, `missing`, `warnings`, método+versión y suficiencia. No rellenes con 0 lo desconocido, no mezcles e1RM de métodos distintos ni SI de modelos distintos, no agrupes variantes.
- Nunca hay datos reales en el repo; el CSV personal de Hevy no se usa como demo.

## Implementación de interfaz

El handoff de la UI implementada, capturas y las capacidades pendientes verificadas están en [../FRONTEND_HANDOFF.md](../FRONTEND_HANDOFF.md). En particular, revisar la falta de identidades y protocolos en la lectura de sesiones antes de considerar universal el registro o la edición por segmento.
