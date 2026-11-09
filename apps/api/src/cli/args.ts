/** Parseo mínimo de argumentos `--clave valor` y banderas `--bandera`. */
export function parseArgs(argv: string[]): { flags: Set<string>; opts: Map<string, string> } {
  const flags = new Set<string>();
  const opts = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      opts.set(k, next);
      i++;
    } else flags.add(k);
  }
  return { flags, opts };
}
