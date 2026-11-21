import { number } from '../workspace/ui';
import type { CSSProperties } from 'react';
import { parseRpe, rpeStyle } from '../rpeScale';

/** RPE con su color de la escala 0–10 y el número adentro. Sin valor muestra «—» sin color (dato faltante ≠ cero). */
export function RpeChip({
  value,
  label = 'RPE',
  title,
}: {
  value: number | null | undefined;
  /** Texto antes del número («RPE», «RPE real»…). `null` muestra solo el número. */
  label?: string | null;
  title?: string;
}) {
  const style = rpeStyle(value);
  if (!style) return <span className="rpe-none">{label ? `${label} ` : ''}—</span>;
  return (
    <span className="rpe-chip" style={style} title={title ?? `RPE ${number(value)}`}>
      {label ? `${label} ` : ''}
      {number(value)}
    </span>
  );
}

/** Props para un `<input>` de RPE: si lo escrito es un RPE válido, se pinta con su color; si no, queda como cualquier input. */
export function rpeInputProps(text: string | null | undefined): {
  className?: string;
  style?: CSSProperties;
} {
  const style = rpeStyle(parseRpe(text));
  return style ? { className: 'rpe-input', style } : {};
}
