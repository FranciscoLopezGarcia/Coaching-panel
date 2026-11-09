# Motor de decisiones de coaching

App **local** (para pruebas y mejoras) que procesa los registros de los atletas y muestra hallazgos para decidir como coach:
evolución por levantamiento, margen de carga, posible fin de respuesta y calidad de los datos. **Informa, explica y propone; no modifica
rutinas.** Los parámetros y reglas son una **propuesta operativa V0.1** (ver `docs/REGLAS_Y_PROCEDENCIA.md`).

## Estructura

```
packages/engine      Dominio puro (TypeScript, sin I/O): e1RM, exposiciones, reglas, prioridades, fusión de decisiones
packages/contracts   Esquemas zod de entrada y tipos de salida compartidos por api y web
apps/api             Fastify + SQLite (node:sqlite): db/ → repositories/ → services/ → routes/
apps/web             React + Vite: dashboard del plantel y perfil del atleta
docs/                Arquitectura y procedencia de reglas
.github/workflows    CI (formato, lint, tipos, tests, build)
```

## Requisitos y arranque

Node ≥ 22.13 (usa `node:sqlite`, sin dependencias nativas).

```bash
npm install
cp .env.example .env     # opcional
npm run seed             # 3 atletas SINTÉTICOS de demostración
npm run dev              # API en :3001 y web en http://localhost:5173
```

## Comandos

| Comando                           | Qué hace                                       |
| --------------------------------- | ---------------------------------------------- |
| `npm run dev`                     | API + web en modo desarrollo                   |
| `npm test`                        | Tests de engine, contracts, api y web          |
| `npm run typecheck` / `lint`      | Tipos y ESLint                                 |
| `npm run format` / `format:check` | Prettier                                       |
| `npm run build`                   | Bundle de la API (`apps/api/dist`) y de la web |
| `npm run ci`                      | Todo lo anterior, igual que el pipeline        |

## Datos y privacidad

- La DB es un archivo local (`apps/api/data/*.sqlite`), ignorado por git.
- `.gitignore` y el CI **rechazan** CSV y bases de datos versionados. El export personal de Hevy **no** se incorpora ni se usa como demo.
- Los datos de `npm run seed` son sintéticos.

## Estado

Las 4 etapas del motor están implementadas (local, sin despliegue):

1. **Registro y reglas base:** calidad de datos, `B-DOLOR`, `R-PROGRESS`, `R-LOAD`, `R-END`, decisión del coach e idempotencia.
2. **Expresión y PR:** `R-EXPRESSION` (modo A: PRG reconstruido desde texto; modo B: motor propio) y `R-PR` (récord de peso para reps; single máximo apagado).
3. **Historial y comparativas:** versiones del plan, eventos de cambio detectados solos (NL, frecuencia, perfil, referencia, duración), desviaciones de ejecución, seguimiento posterior sin causalidad y comparativas A/B por semana (planificado y realizado separados).
4. **Experimentos y TTP:** `R-VOLUME`, `R-FREQUENCY`, TTP observado por bloque/familia y candidatos «golden».

La UI BASE tiene inicio del coach y perfil con resumen, programación jerárquica, análisis, seguimiento, configuración y registro móvil local. Ver `docs/FRONTEND_HANDOFF.md` para recorridos, capturas y límites reales del backend.

Pendiente: autenticación/roles, lectura íntegra de prescripción e IDs de serie para registro universal, validar las reglas con datos reales y prospectivos, despliegue. Ver `docs/`.

## Consolidación del motor (reglas-v0.2-propuesta / params-v2)

- Métricas observadas separadas (e1RM por curva con RPE real, e1RM PRG 6 fórmulas, referencia de fuerza); abstención por regla, nunca relleno de RPE.
- Estado multidimensional por lift, recomendaciones explicables, ciclo hallazgo→intervención→seguimiento, exposiciones con identidad estable.
- Programación (operaciones puras + preview), consultas semanales/meso/macro, importador Hevy CSV (dry-run), plan CSV canónico, replay.
- Documentos: `docs/MIGRACION_Y_COMPATIBILIDAD.md`, `docs/VALIDACION_Y_REPLAY.md`. Informe: `analisis/features/consolidacion-motor-coaching/outputs/informe-final.md`.
- CSV personal de Hevy: **nunca** se versiona; solo fixtures sintéticos.
- Hevy dry-run: `npm run import:hevy -w @coaching/api -- --athlete <id> --file <csv>` (aplicar: `--apply --token <t>`).

## Frontend BASE

Guía de ejecución, integraciones, pruebas de navegador y pendientes para Claude: [docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md). El frontend no calcula reglas ni fórmulas del motor. La vista atleta es una demostración local sin autenticación.
