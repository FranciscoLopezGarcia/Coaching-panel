# Perfil, competencias, hoy/semana, biblioteca, plantillas de bloque y cumplimiento

Migración `009_perfil_competencias_biblioteca.sql` (solo aditiva: tablas nuevas y columnas con valor por defecto).

## Perfil ampliado (`GET/PUT /api/athletes/:id/profile`)

Fecha de nacimiento, sexo, peso, categoría, federación, equipamiento, entrena desde, días por semana, objetivos, antecedentes y limitaciones.
Todo es opcional: lo que no se carga queda vacío (nunca 0). **No cambia ningún cálculo**; solo aparece en la UI (pestaña Perfil) y en el resumen exportado.

## Competencias, intentos y marcas

- `GET /api/athletes/:id/competitions-detail`, `PATCH/DELETE /api/athletes/:id/competitions/:compId` (alta: `POST /competitions`).
  Campos nuevos: lugar, categoría, peso en la competencia, prioridad (A/B/C), notas.
- `PUT /api/athletes/:id/competitions/:compId/attempts`: hasta 3 intentos por movimiento. **Previsto y realizado van en columnas separadas**;
  el resultado (válido/nulo) solo se guarda si hay carga realizada. Los intentos de una competencia se reemplazan juntos (una sola transacción).
- «Total» = suma de los mejores intentos **válidos** de los tres movimientos; si falta alguno, es `null` (faltante ≠ cero).
- `GET /api/athletes/:id/marks`: marca de competencia (mejor intento válido) **al lado** de lo hecho en entrenamiento con el ejercicio de
  competencia del atleta (mayor carga, mejor single, mejor e1RM con RPE real). `diffKg` = competencia − mejor single: descriptivo, sin decir
  cuál es «mejor» y sin estimar una marca a partir de la otra.

## Hoy y semana

`GET /api/athletes/:id/agenda?date=` (semana lunes–domingo) y `GET /api/today?date=` (todo el plantel). Solo lectura.
Estado de sesión: `hecha` (todas las series hechas), `parcial`, `sin_registro` (fecha pasada sin ninguna serie registrada) y `pendiente`.
«Sin registro» no equivale a «omitida».

## Biblioteca de ejercicios

- Fija: `packages/engine/src/exercise-library.ts` (movimiento, rol sugerido, equipo). Músculos y patrón **salen de las mismas reglas por nombre**
  que usa el análisis (un test exige que cada ejercicio fijo tenga ambos).
- Propia: `GET/POST /api/exercise-library`, `PUT/DELETE /api/exercise-library/:id` (global del coach). Si declara músculos, aportan al análisis
  de todos los atletas; **el mapa propio de un atleta (Configuración → Músculos) gana**. Sin músculos declarados rige la regla por nombre.
- Al programar, el campo «Ejercicio» autocompleta y sugiere movimiento y rol (editables; nunca pisa lo ya elegido).

## Plantillas de bloque

`POST /api/athletes/:id/block-templates` guarda **todas las semanas** de un bloque (sin fechas absolutas, sin resultados, sin ids de instancia).
Se aplica con la operación `apply_block_template` (`{ templateId, blockKey, startDate, familyKey?, replaceExisting? }`) en el mismo flujo de
vista previa → borrador → publicar que el resto de la programación. Si el bloque destino ya tiene series, exige `replaceExisting`.
`GET /templates` lista `kind: 'semana' | 'bloque'`; cada tipo se aplica solo con su operación.

## Cumplimiento (en `GET /block-analysis`, campo `compliance`)

Por bloque y por semana, hasta el corte y sin calentamientos: sesiones con trabajo/completas, series hechas, omitidas y **sin registro**
(previstas sin dato), y carga/reps/RPE real vs. previsto **solo sobre las series que tienen ambos datos** (se informa cuántas). Descriptivo.
