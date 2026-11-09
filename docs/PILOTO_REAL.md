# Piloto real: cargar UN bloque de un atleta real

Objetivo: probar el sistema con un bloque real **sin inventar faltantes**. Nada de esto se ejecuta por sí solo: cada escritura requiere tu selección y tu confirmación explícita. Los datos personales no se versionan ni se copian al proyecto.

## 0. Reglas

- Trabajá sobre una BD **de piloto** distinta del laboratorio (`DB_PATH=./data/piloto.sqlite`). El laboratorio es ficticio y no se mezcla con datos reales.
- Hacé una copia del archivo `.sqlite` antes de cualquier importación (`cp data/piloto.sqlite data/piloto.sqlite.antes-AAAAMMDD`).
- Lo que no tengas, queda vacío: sin RPE → sin e1RM por curva; sin referencia → sin intensidad relativa; sin cuestionario → sin recuperación. El sistema lo informa como faltante.
- Nada de pegar el CSV personal de Hevy en el repositorio ni usarlo como fixture.

## 1. Ficha previa (completala vos)

| Dato                                             | Cómo se carga                                                             | Si falta                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Atleta (nombre, ejercicios de competencia)       | UI o `POST /api/athletes`                                                 | obligatorio                                                           |
| Fechas del bloque (inicio, fin, semanas)         | macro/meso: `POST /macros`, `PUT /mesos`                                  | la vista por período sigue funcionando                                |
| Objetivo del bloque                              | `objective` del macro/meso y `families.<clave>.objective` en parámetros   | R-END no interpreta una estabilidad sin objetivo                      |
| Ejercicios y variantes                           | columnas `exercise`, `variant`, `exposure_id`, `lift` del CSV             | si no declarás `exposure_id`, se deriva del nombre y se marca         |
| Referencias de fuerza (fecha, origen, ejercicio) | `POST /references`                                                        | sin referencia no hay % ni intensidad relativa                        |
| Cambio mínimo relevante, paso de carga           | `PUT /params` (`perLift`)                                                 | R-PROGRESS/R-END/R-PR quedan suspendidos y lo dicen (`missingConfig`) |
| Prescripción                                     | CSV `plan-canonical-v1`                                                   | obligatorio para comparar previsto/realizado                          |
| Ejecución                                        | `POST /sets` o la pantalla de registro (cada serie por su `plannedSetId`) | sin ejecución no hay análisis                                         |
| Cuestionarios                                    | `POST /checkins`, `POST /session-feedback`                                | sin cuestionario no se infiere recuperación                           |

## 2. Procedimiento (cada paso es reversible o de solo lectura hasta el paso 5)

1. **Crear el atleta** en la BD de piloto (UI o API).
2. **Parámetros y referencias** con sus fechas reales.
3. **Plantilla de programación**: copiá `docs/piloto-real/plantilla-plan.csv` fuera del repositorio y completala con el bloque real (una fila por ejercicio de la sesión; protocolo con la gramática estricta `3x5@8 + 2x8x100`; sin texto libre).
4. **Dry-run de la programación** (no escribe nada):
   ```bash
   DB_PATH=./data/piloto.sqlite npm run import:plan -w @coaching/api -- --athlete <id> --file /ruta/fuera/del/repo/plan.csv
   ```
   Revisá errores, advertencias y la **disponibilidad** de métricas previstas. Corregí el CSV y repetí.
5. **Aplicar** (escribe): solo si estás de acuerdo con lo que mostró el dry-run:
   ```bash
   DB_PATH=./data/piloto.sqlite npm run import:plan -w @coaching/api -- --athlete <id> --file /ruta/plan.csv --apply --token <token del dry-run> --label "Bloque piloto"
   ```
6. **Ejecución**: registrala por la pantalla de registro o con `POST /sets` (el id de cada serie sale de `GET /plan` o `GET /sessions`). Si usás Hevy, `import:hevy` carga _observaciones_ (no vinculadas a la prescripción): sirven para métricas y series, no para cumplimiento. El dry-run de Hevy se hace igual con `import:hevy` y su token.
7. **Cuestionarios** disponibles: `POST /checkins` / `POST /session-feedback` solo con los que existan.
8. **Informe de preparación** (solo lectura): qué hay y qué falta:
   ```bash
   DB_PATH=./data/piloto.sqlite npm run pilot:check -w @coaching/api -- --athlete <id> --cutoff AAAA-MM-DD
   ```
9. **Evaluar al corte** elegido (`POST /evaluate {cutoff}`), mirar evidencias y decidir con el coach. Las propuestas no modifican la programación; aceptar no es aplicar.

## 3. Qué NO hace el sistema con datos reales

No deduce prescripción de lo ejecutado, no rellena RPE con el objetivo, no completa cuestionarios, no infiere descanso, no convierte series submáximas en tests máximos, no mezcla variantes ni métodos de e1RM, y no promete resultados.

## 4. Archivos

- `docs/piloto-real/plantilla-plan.csv` — encabezado y UNA fila de ejemplo ficticia (borrala).
- Comandos: `import:plan`, `import:hevy`, `pilot:check`, `lab:create` en `apps/api/package.json`.
