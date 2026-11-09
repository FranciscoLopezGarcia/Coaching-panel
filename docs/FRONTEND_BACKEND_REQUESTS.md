# BASE · coordinación del laboratorio y frontend

Actualizado 2026-11-06. Alcance de esta entrega: `apps/web/`, tests y documentación frontend. No se modificaron motor, contratos, API ni bases reales.

## Resuelto e integrado

- IDs oficiales, variantes, protocolos, segmentos, aproximaciones y series retiradas de `GET /sessions`. Se retiró la dependencia del registro en IDs locales o en ejecuciones previas.
- Creación de sesiones mediante `POST /program`, operación `add_sets`, con preview real antes de publicar. No se usa un preview simulado.
- Preview y publicación reenvían `baseVersionId`; un conflicto 409 se muestra sin sobrescribir, y exige volver a previsualizar.
- Selector de series concretas (`setIds`) para cambiar protocolos. Duplicación y repetición preservan la separación de resultados.
- Consulta de versiones completas por `GET /plan-versions/:id`: los borradores guardados pueden abrirse como tabla desde Programación. Abrir no publica ni restaura automáticamente un snapshot completo.
- Proyección de Claude integrada con fecha de corte explícita. Baseline seleccionado se presenta como «Proyección de mantenimiento del nivel reciente»; se conservan los puntos calculados por el backend.

## Coordinación pendiente del laboratorio

1. **Laboratorio persistente conectado:** frontend 5200 → API 3200 → `apps/api/data/base-laboratorio-persistente-20261106.sqlite`, identidad `lab-2026-06-01-97009367`. Se creó en una ruta exclusiva mediante el comando de Claude; A–F están cargados. Persistencia verificada tras recarga y reinicio de los procesos propios. Ya no hay bloqueo de conexión ni fallback a memoria.
2. **Identificación/catálogo: resuelto por Claude e integrado.** `/api/instance` y `/health.instance` identifican laboratorio/personal/conjunto; el frontend lee casos, objetivos y cortes del catálogo oficial. No deduce identidad de nombres ni duplica las guías del generador. Antes de cualquier escritura verifica que el conjunto y modo sigan siendo los de la pantalla.
3. **Vigencia entre clientes: resuelta por Claude e integrada.** `/state.freshness` detecta cambios de las entradas conocidas al corte. Se refresca al cargar, guardar y recuperar foco. No se afirma actualización en tiempo real; los avisos locales son respaldo, no sustituyen la huella del servidor.

## Otras capacidades pendientes verificadas

- Edición de macro, desglose muscular planificado, comparación oficial de prescripción entre semanas y deltas por exposición.
- Detalle de meso vacío ya responde 200 y la selección de macro activo informa otras opciones: resuelto por Claude, no es un bloqueo.
- Sin autenticación/roles; el modo de laboratorio es una identificación de entorno, no aislamiento de usuarios. No hay botón de reinicio de datos.
- No hay operación dedicada para restaurar un borrador íntegro con preview contra el plan actual; el lector de borradores no se presenta como esa operación.

## Precisión del análisis esencial · 2026-11-08

- **Dosis realizada oficial por sesión/variante: resuelta e integrada.** `GET /core?view=sessions` entrega SI, NL, tonelaje, e1RM y volumen muscular por entrenamiento. El adaptador `apps/web/src/workspace/core.ts` consume la versión `nucleo-v1`; el frontend no agrupa ni recalcula. Los totales planificados por sesión no están en esta proyección; se conserva el detalle de prescripción y ejecución de `/sessions`.
- **Volumen muscular planificado:** continúa pendiente. Se muestra el realizado, con convención y ejercicios no mapeados.
- **1RM real:** el catálogo de marcas expone mejor single, que no acredita por sí solo un test máximo. Se muestran los singles realizados disponibles en `/sessions`, separados del e1RM; no se fabrica una historia de máximos validados.

## Patrones y SI muscular solicitados por el coach · 2026-11-08

La clasificación deseada distingue SQ, BP, DL, tracción horizontal, tracción vertical, empuje horizontal (pectoral), empuje vertical (hombro), cuádriceps, isquios y core; permite mayor detalle muscular.

- **Disponible e integrado:** `/core?lift=SQ|BP|DL&view=all` proporciona totales oficiales semanales y por sesión para cada movimiento. `/weekly` y `/core.sessions[].exercises[]` dan SI por ejercicio/variante. Todos usan `rts-aprox-v1`, sin mezclar escalas.
- **Bloqueo concreto:** `/core` ya devuelve `exercises[].pattern` y volumen por patrón (`patrones-v1`), incorporados por Claude durante el trabajo; no devuelve SI agregado por patrón ni SI distribuido por músculo. `muscles.rows` trae series/reps/tonelaje equivalentes y ejercicios; no trae SI. `weekly-muscles` tampoco. El frontend no puede deducir SI muscular multiplicando por el peso de aportes usado para volumen.
- **Requerido al backend:** edición del catálogo de patrones ya versionado, SI agregado oficial por patrón/semana/sesión y una definición explícita de si el SI muscular será un aporte asignado o SI de ejercicios asociados. Cada grupo debe traer método, unidad, disponibilidad, faltantes, ejercicios/series incluidos y advertencia de superposición. No sumar BP con empuje horizontal o SQ con cuádriceps como si fueran categorías disjuntas.
- **Presentación provisional honesta:** los totales SQ/BP/DL son oficiales. La clasificación inicial usa el patrón oficial de cada ejercicio; el coach puede ajustar las curvas individuales en los cuatro patrones desde «Organizar ejercicios por patrón». Es una preferencia de gráficos de este navegador, no una reclasificación del motor ni un agregado oficial. Los músculos muestran volumen; el SI muscular permanece identificado como pendiente.
- **Planilla:** cambios diferentes por serie se publican mediante operaciones `change_protocol` agrupadas por contenido, con `setIds`, preview y control de versión. No existe un endpoint atómico de múltiples cambios diferentes; si una operación falla se conserva el resto del borrador. Sería útil un batch atómico con preview conjunto para evitar versiones intermedias y presentar el efecto combinado oficial.

## Adaptación a variables núcleo y rangos · 2026-11-08 (revisión posterior)

- **Integrado:** `protocol.repsMax` en creación/edición de planillas y lectura de prescripción; `fatiga-v2` en detalle de registro; totales oficiales `patterns` por semana/sesión; repeticiones y tonelaje equivalentes musculares; revisión SI consultada desde `/tables/si/rts`.
- **Desajuste de tipos para Claude:** `protocolSchema` ya declara `repsMax`, pero el protocolo escrito a mano dentro de `SessionRow.sets[].protocol` en `packages/contracts/src/index.ts` todavía lo omite. La API sí lo serializa. El frontend lo lee con un adaptador de presentación seguro (`prescription.ts`) y envía el tipo nuevo de `ImportPlanInput`; no se cambiaron contratos compartidos.
- **Sigue pendiente:** SI agregado por patrón y asignación muscular de SI; las nuevas filas `patterns` contienen series, NL y tonelaje, no SI. No se reabrió ese bloqueo como si los totales de volumen faltaran.
