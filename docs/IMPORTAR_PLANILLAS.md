# Importar planillas viejas: CSV estándar (`plan-canonical-v1`)

En **Configuración → Importaciones → Plan canónico** hay un botón «Descargar CSV de ejemplo». Pasá tu planilla a ese formato (una fila por ejercicio por sesión) y subila: primero se ve una **vista previa sin escribir nada** (errores por línea) y recién después se aplica.

| Columna                                        | Obligatoria | Qué es                                                                                                                                      |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `block`                                        | sí          | Nombre/clave del bloque (meso).                                                                                                             |
| `week`                                         | sí          | Semana dentro del bloque (entero ≥ 1).                                                                                                      |
| `date`                                         | sí          | Fecha `yyyy-mm-dd`. **No se infiere**.                                                                                                      |
| `exercise`                                     | sí          | Nombre del ejercicio.                                                                                                                       |
| `protocol`                                     | sí          | `3x5@8`, `1x5x140@7 + 3x5x125@8` (series x reps x kg @RPE). Top set / back-off son solo una forma de escribirlo: no hace falta que existan. |
| `day`                                          | no          | Día de la semana 1–7 (si falta se deduce de la fecha).                                                                                      |
| `session`                                      | no          | Clave de sesión (si falta: `bloque-wN-dN`).                                                                                                 |
| `exposure_id`                                  | no          | Identidad del ejercicio (si falta se deriva del nombre).                                                                                    |
| `lift`                                         | no          | `SQ`, `BP`, `DL` o vacío (accesorios).                                                                                                      |
| `role`                                         | no          | **Rol del movimiento**: `primaria` (básico), `secundaria` (variante), `accesorio`. Vacío = sin rol.                                         |
| `priority`                                     | no          | Orden/importancia 1–5 (distinto del rol). Vacío = sin prioridad.                                                                            |
| `variant`, `ref_kg`, `family`, `slot`, `notes` | no          | Variante, referencia (kg), familia, slot y nota.                                                                                            |

Reglas: lo que falta queda vacío (nunca 0); plan y ejecución no se mezclan; reimportar el mismo archivo no duplica.
