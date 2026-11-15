/** Pure helpers for choosing graph ranges. */

function niceUnit(span: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1
  const p = 10 ** Math.floor(Math.log10(span))
  const r = span / p
  if (r < 2) return p / 5
  if (r < 5) return p / 2
  return p
}

/**
 * Keep the default domain when every value fits (so curve shifts are visible
 * against fixed axes); otherwise widen to include all values with some
 * padding, rounded outward to a "nice" unit.
 */
export function fitDomain(defaultDomain: [number, number], values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite)
  let [lo, hi] = defaultDomain
  const span = hi - lo
  const margin = span * 0.05
  const vMin = Math.min(...finite, Infinity)
  const vMax = Math.max(...finite, -Infinity)
  if (vMin >= lo + margin && vMax <= hi - margin) return [lo, hi]
  const pad = Math.max(vMax - vMin, span) * 0.1
  if (vMin < lo + margin) lo = vMin - pad
  if (vMax > hi - margin) hi = vMax + pad
  const unit = niceUnit(hi - lo)
  return [Math.floor(lo / unit) * unit, Math.ceil(hi / unit) * unit]
}

export function linspace(a: number, b: number, n: number): number[] {
  if (n < 2) return [a]
  return Array.from({ length: n }, (_, j) => a + ((b - a) * j) / (n - 1))
}
