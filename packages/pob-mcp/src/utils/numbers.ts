/**
 * Coerce a PoB stat to a finite number. PoB's output table is stringly typed
 * in a handful of fields and the JSON round-trip can widen/shape values, so
 * every numeric consumer must narrow through this helper (or Number()) rather
 * than assume the wire type. NaN/undefined => not reported by PoB.
 */
export function toFiniteNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

