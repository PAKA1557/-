import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ADAS_DEFAULTS,
  ADAS_HORIZON,
  adasModel,
  adCoefficients,
  initialState,
  longRun,
  longRunPrice,
  priceSRAS,
  simulateShock,
  verticalAD,
  yAD,
  type ADASParams,
  type ADASRegime,
  type PeriodState,
} from './adas'
import type { ScenarioInput, Solution } from './types'

const D = ADAS_DEFAULTS
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)

/** Solve a scenario against the default money-target baseline, as the UI does. */
function run(values: Record<string, number>, regime = 'money', baseValues: Record<string, number> = {}, baseRegime = 'money') {
  const baseInput: ScenarioInput = { regime: baseRegime, values: baseValues }
  const base = adasModel.solve(baseInput)
  const input: ScenarioInput = { regime, values }
  const cur = adasModel.solve(input, { baseline: base })
  return { base, cur, baseInput, input }
}

const series = (s: Solution, key: string) => s.timePaths!.find((p) => p.key === key)!.values

function residuals(p: ADASParams, regime: ADASRegime, s: PeriodState) {
  return { ad: s.Y - yAD(p, regime, s.P), as: s.P - priceSRAS(p, s.Pe, s.Y) }
}

describe('AD-AS steady state at defaults', () => {
  it('Y = Ȳ = 1100, P = Pe = 2, i = 6 exactly', () => {
    const s0 = initialState(D, 'money')
    close(s0.Y, 1100)
    close(s0.P, 2)
    close(s0.Pe, 2)
    close(s0.i, 6)
    close(yAD(D, 'money', 2), 1100)
    close(longRunPrice(D)!, 2)
    const sol = adasModel.solve({ regime: 'money', values: {} })
    for (const k of ['Y0', 'Y1', 'YLR']) close(sol.values[k], 1100)
    for (const k of ['P0', 'P1', 'PLR']) close(sol.values[k], 2)
    for (const k of ['i0', 'i1', 'iLR']) close(sol.values[k], 6)
    expect(sol.warnings).toEqual([])
  })

  it('AD at defaults is Y = 850 + 500 / P', () => {
    const { alpha, beta } = adCoefficients(D)
    close(alpha, 850)
    close(beta, 500)
  })

  it('the rate peg at i = 6 puts the vertical AD exactly on LRAS', () => {
    close(verticalAD(D), 1100)
  })
})

describe('every simulated period lies on AD and SRAS', () => {
  it.each([
    { values: { M: 1200 }, regime: 'money' },
    { values: { G: 150 }, regime: 'money' },
    { values: { G: 60, pe: 2, a: 40 }, regime: 'money' },
    { values: { G: 130 }, regime: 'rate' },
    { values: { i: 6.04 }, regime: 'rate' },
  ])('$regime $values', ({ values, regime }) => {
    const cur = { ...D, ...values }
    const { path } = simulateShock(D, 'money', cur, regime as ADASRegime)
    expect(path).toHaveLength(ADAS_HORIZON + 1)
    // period 0 is the baseline equilibrium
    const r0 = residuals(D, 'money', path[0])
    expect(Math.abs(r0.ad)).toBeLessThan(1e-9)
    expect(Math.abs(r0.as)).toBeLessThan(1e-9)
    for (const s of path.slice(1)) {
      const r = residuals(cur, regime as ADASRegime, s)
      expect(Math.abs(r.ad)).toBeLessThan(1e-9)
      expect(Math.abs(r.as)).toBeLessThan(1e-9)
      expect(s.P).toBeGreaterThan(0)
    }
    // adaptive expectations
    for (let t = 1; t < path.length; t++) expect(path[t].Pe).toBe(path[t - 1].P)
  })
})

describe('convergence after a shock (money target)', () => {
  it.each([{ M: 1200 }, { M: 800 }, { G: 150 }, { G: 50 }])('%o: monotone, no oscillation, |Y_T − Ȳ| small', (shock) => {
    const { path } = simulateShock(D, 'money', { ...D, ...shock }, 'money')
    const gap = path.map((s) => s.Y - D.Yn)
    const sign = Math.sign(gap[1])
    expect(sign).not.toBe(0)
    for (let t = 2; t <= ADAS_HORIZON && Math.abs(gap[t - 1]) > 1e-9; t++) {
      // same side of Ȳ every period, strictly shrinking gap: monotone convergence
      expect(Math.sign(gap[t])).toBe(sign)
      expect(Math.abs(gap[t])).toBeLessThan(Math.abs(gap[t - 1]))
      // the price level moves in one direction toward P_LR
      expect(Math.sign(path[t].P - path[t - 1].P)).toBe(sign)
    }
    expect(Math.abs(gap[ADAS_HORIZON])).toBeLessThan(1e-3)
    const PLR = longRunPrice({ ...D, ...shock })!
    expect(Math.abs(path[ADAS_HORIZON].P - PLR)).toBeLessThan(1e-4)
  })

  it('M = 1200: hand-checked first periods', () => {
    const { path } = simulateShock(D, 'money', { ...D, M: 1200 }, 'money')
    // period 1 (Pe = 2, α = 850, β = 600): 100 P² + 50 P − 600 = 0 ⇒ P = (−50 + √242500) / 200
    close(path[1].P, (-50 + Math.sqrt(242500)) / 200)
    close(path[1].Y, 850 + 600 / path[1].P)
  })
})

describe('long run', () => {
  it('money neutrality: M × 1.2 scales P_LR by 1.2, leaves Y, i, r, I unchanged', () => {
    const a = longRun(D, 'money', 2)!
    const b = longRun({ ...D, M: D.M * 1.2 }, 'money', 2)!
    close(b.P, a.P * 1.2)
    close(b.Y, a.Y)
    close(b.i, a.i)
    close(b.r, a.r)
    close(b.I, a.I)
    close(b.M, a.M * 1.2)
  })

  it('neutrality holds over random parameters', () => {
    fc.assert(
      fc.property(params, fc.double({ min: 0.5, max: 2, noNaN: true }), (p, lambda) => {
        fc.pre(longRunPrice(p) !== null)
        const a = longRun(p, 'money', 1)!
        const b = longRun({ ...p, M: p.M * lambda }, 'money', 1)!
        const tol = 1e-9 * Math.max(1, Math.abs(a.P * lambda))
        return (
          Math.abs(b.P - a.P * lambda) < tol &&
          Math.abs(b.Y - a.Y) < 1e-9 * Math.max(1, a.Y) &&
          Math.abs(b.i - a.i) < 1e-7 &&
          Math.abs(b.r - a.r) < 1e-7
        )
      }),
    )
  })

  it('fiscal expansion: Y back to Ȳ, P and i higher, investment lower by ΔG (full crowding out)', () => {
    const { base, cur } = run({ G: 150 })
    const b = base.values
    const c = cur.values
    close(c.YLR, D.Yn)
    expect(c.PLR).toBeGreaterThan(b.PLR)
    expect(c.iLR).toBeGreaterThan(b.iLR)
    expect(c.ILR).toBeLessThan(b.ILR)
    close(c.ILR - b.ILR, -50)
    close(c.CLR, b.CLR) // C depends on Y and T only
    close(c.PLR, 10 / 3)
    close(c.iLR, 8)
    // short run: output, price level and rate rise
    close(c.Y1, 1150)
    close(c.P1, 2.5)
    expect(c.i1).toBeGreaterThan(b.i1)
  })
})

describe('rate-target regime', () => {
  it('AD is vertical', () => {
    const { cur } = run({ G: 130 }, 'rate')
    const ad = cur.curves.find((c) => c.id === 'AD')!
    expect(new Set(ad.points.map((p) => p.x)).size).toBe(1)
    close(ad.points[0].x, verticalAD({ ...D, G: 130 }))
  })

  it('price level drifts by (Y_AD − Ȳ)/a every period and the warning is emitted', () => {
    const { cur } = run({ G: 130 }, 'rate')
    const Yad = verticalAD({ ...D, G: 130 })
    close(Yad, 1220)
    const P = series(cur, 'P')
    const Y = series(cur, 'Y')
    for (let t = 1; t <= ADAS_HORIZON; t++) {
      close(Y[t], Yad)
      close(P[t] - P[t - 1], (Yad - D.Yn) / D.a, 1e-9)
    }
    close(P[ADAS_HORIZON], 2 + ADAS_HORIZON * 1.2, 1e-9)
    expect(Number.isNaN(cur.values.PLR)).toBe(true)
    const w = cur.warnings.find((x) => x.key === 'P')
    expect(w?.message).toContain('닻')
    expect(w?.message).toContain('테일러 준칙')
  })

  it('a rate hike makes the price level fall without limit (path stops before P ≤ 0)', () => {
    const { cur } = run({ i: 7 }, 'rate')
    const P = series(cur, 'P').filter(Number.isFinite)
    for (let t = 1; t < P.length; t++) expect(P[t]).toBeLessThan(P[t - 1])
    expect(P.every((x) => x > 0)).toBe(true)
    expect(cur.warnings.some((w) => w.message.includes('닻'))).toBe(true)
  })

  it('no drift when the vertical AD sits on LRAS', () => {
    const { cur } = run({}, 'rate')
    const P = series(cur, 'P')
    for (const x of P) close(x, 2)
    close(cur.values.PLR, 2)
    expect(cur.warnings).toEqual([])
  })

  it('locks M in the rate regime and i in the money regime', () => {
    expect(adasModel.lockedVariables('rate').map((l) => l.key)).toEqual(['M'])
    expect(adasModel.lockedVariables('money').map((l) => l.key)).toEqual(['i'])
    const { cur } = run({}, 'rate')
    close(cur.values.M1, 1000)
  })
})

describe('graph data', () => {
  it('marks E₀, the short run and the long run, with one SRAS per period', () => {
    const { cur } = run({ M: 1200 })
    expect(cur.markers!.map((m) => m.kind)).toEqual(['baseline', 'short', 'long'])
    expect(cur.trajectory!.points).toHaveLength(ADAS_HORIZON + 1)
    expect(cur.trajectory!.curves).toHaveLength(ADAS_HORIZON + 1)
    expect(cur.curves.map((c) => c.id)).toEqual(['AD', 'SRAS', 'LRAS'])
    const ad = cur.curves[0]
    const p = { ...D, M: 1200 }
    for (const pt of ad.points) close(pt.x, yAD(p, 'money', pt.y), 1e-7)
    for (let j = 1; j < ad.points.length; j++) expect(ad.points[j].x).toBeGreaterThanOrEqual(ad.points[j - 1].x)
  })

  it('explains short run vs long run and neutrality', () => {
    const { base, cur, baseInput, input } = run({ M: 1200 })
    const text = adasModel.explain({ input: baseInput, solution: base }, { input, solution: cur }).join(' ')
    expect(text).toContain('AD 오른쪽 이동')
    expect(text).toContain('화폐 중립성')
    expect(text).toContain('단조 수렴')
  })
})

// Sane parameter ranges (match the UI sliders).
const params: fc.Arbitrary<ADASParams> = fc.record({
  c0: fc.constant(200),
  b0: fc.constant(200),
  c1: fc.double({ min: 0.5, max: 0.9, noNaN: true }),
  T: fc.double({ min: 0, max: 300, noNaN: true }),
  b1: fc.double({ min: 5, max: 50, noNaN: true }),
  G: fc.double({ min: 0, max: 300, noNaN: true }),
  M: fc.double({ min: 600, max: 1400, noNaN: true }),
  k: fc.double({ min: 0.5, max: 1.5, noNaN: true }),
  h: fc.double({ min: 50, max: 200, noNaN: true }),
  pe: fc.double({ min: -2, max: 5, noNaN: true }),
  i: fc.double({ min: 0, max: 12, noNaN: true }),
  a: fc.double({ min: 20, max: 400, noNaN: true }),
  Yn: fc.double({ min: 900, max: 1300, noNaN: true }),
})

describe('property tests', () => {
  it('short-run Y rises with G and with M; P_t > 0 throughout (money target)', () => {
    fc.assert(
      fc.property(params, fc.double({ min: 1, max: 100, noNaN: true }), fc.double({ min: 10, max: 400, noNaN: true }), (p, dG, dM) => {
        const y1 = (q: ADASParams) => simulateShock(p, 'money', q, 'money').path[1].Y
        const lo = y1(p)
        const sim = simulateShock(p, 'money', { ...p, G: p.G + dG, M: p.M + dM }, 'money')
        return (
          y1({ ...p, G: p.G + dG }) > lo &&
          y1({ ...p, M: p.M + dM }) > lo &&
          !sim.truncated &&
          sim.path.every((s) => s.P > 0 && Number.isFinite(s.Y))
        )
      }),
    )
  })

  it('AD and SRAS residuals vanish in every period', () => {
    fc.assert(
      fc.property(params, params, fc.constantFrom<ADASRegime>('money', 'rate'), (base, cur, regime) => {
        const { path } = simulateShock(base, 'money', cur, regime)
        return path.slice(1).every((s) => {
          const r = residuals(cur, regime, s)
          return Math.abs(r.ad) < 1e-9 * Math.max(1, Math.abs(s.Y)) && Math.abs(r.as) < 1e-9 * Math.max(1, Math.abs(s.P))
        })
      }),
    )
  })

  it('convergence is monotone whenever a long-run equilibrium exists', () => {
    fc.assert(
      fc.property(params, params, (base, cur) => {
        fc.pre(longRunPrice(base) !== null && longRunPrice(cur) !== null)
        const { path } = simulateShock(base, 'money', cur, 'money')
        const PLR = longRunPrice(cur)!
        const d = path.slice(1).map((s) => s.P - PLR)
        // P_t approaches P_LR from one side without overshooting
        return d.every((x, t) => t === 0 || (Math.sign(x) === Math.sign(d[0]) || Math.abs(x) < 1e-9) && Math.abs(x) <= Math.abs(d[t - 1]) + 1e-12)
      }),
    )
  })
})
