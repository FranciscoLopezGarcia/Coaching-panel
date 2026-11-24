# Analizar

Una sola pantalla y una sola llamada: `GET /api/athletes/:id/analysis` (solo lectura). El navegador **no calcula**: presenta lo que entrega el servidor.

## Principios

- **Una magnitud, un lugar.** Cada magnitud vive en una sola tarjeta, con su gráfico y su tabla vinculados (pasar el mouse por un punto resalta la fila y al revés). Un test (`apps/api/test/analysis.test.ts`) compara el registro del servidor con las familias de la pantalla y falla si algo se declara dos veces o falta.
- **Plan y real separados.** Cada período trae `planned` y `actual`; nunca se completan entre sí. Faltante ≠ 0 ≠ omitido.
- **Sin fuga de futuro.** Todo respeta el corte `asOf`; lo realizado excluye lo posterior.
- **Escalas distintas no se mezclan.** Solo se superponen magnitudes con la misma unidad y la misma familia de escala.
- **Descriptivo.** Sin correlaciones, predicción ni causalidad; sin umbrales inventados (las bandas salen de los parámetros del atleta).

## Datos

- Registro único de métricas: `packages/engine/src/analysis/registry.ts` (id, etiqueta, unidad, grupo, familia de escala, versión prevista, fila equivalente por bloque).
- Períodos (semana del bloque o sesión): `packages/engine/src/analysis/periods.ts` (`buildPeriods`). Reutiliza `groupMetrics` (`metrics.ts`) para que semana y sesión usen las mismas reglas.
- Servicio: `apps/api/src/services/analysis.ts`. Une períodos, comparación de bloques (`block-analysis`), distribución muscular y por patrón (`core`), récords, referencias y TTP/familias.
- Parámetros: `from`, `to`, `asOf`, `lift` (`SQ|BP|DL|ALL`), `granularity` (`week|session`), `block`, `source` (`planned|actual`, origen de la comparación de bloques).

## Pantalla (`apps/web/src/analysis/`)

- **Controles únicos**: movimiento, fuente (Real / Previsto / Ambos), escala (Semana / Sesión), bloque, exportar CSV/JSON. El período lo elige la franja de la ficha.
- **Familias**: Volumen, Carga, Estrés (SI), Esfuerzo, Cumplimiento, Fatiga. Cada una tiene vista por semana/sesión y vista **por bloque** (velas con el rango de las semanas, la mediana y el valor del bloque, unidas por una línea, con la tabla de deltas).
- **Tarjetas propias**: Fuerza (e1RM por variante, récords reales, referencias y proyección experimental como capa opcional), Distribución (series por músculo y por patrón) y Bloques y respuesta (TTP, familias, estructura, cambios de ejercicio y señal de expresión).
- **Comparativa en conjunto**: casilleros por magnitud, por familia y «Elegir todo»; la bandeja inferior abre tres modos: paneles sincronizados (mismo eje de tiempo y cursor, cada uno con su escala), mismo eje (solo misma unidad y familia) y tabla conjunta. La selección vive en la URL (`?sel=`).
- **Detalle de período**: al hacer clic en una fila se abre un panel con todas las magnitudes (real y previsto) y el estado de los datos.
