import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  clipLine,
  coefficients,
  ISMPPC_DEFAULTS,
  ISMPPC_HORIZON,
  ismppcModel,
  longRun,
  persistenceAdaptive,
  simulate,
  stabilityOf,
  steadyState,
  type ISMPPCParams,
  type PeriodState,
} from './ismppc'
import type { Solution } from './types'

const D = ISMPPC_DEFAULTS
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)
const P = (over: Partial<ISMPPCParams> = {}): ISMPPCParams => ({ ...D, ...over })

/** Solve a scenario against a baseline, as the UI does. */
function run(values: Partial<ISMPPCParams>, baseValues: Partial<ISMPPCParams> = {}) {
  const base = ismppcModel.solve({ regime: 'taylor', values: baseValues as Record<string, number> })
  const cur = ismppcModel.solve({ regime: 'taylor', values: values as Record<string, number> }, { baseline: base })
  return { base, cur }
}
const series = (s: Solution, key: string) => s.timePaths!.find((p) => p.key === key)!.values

/** Residuals of the five model equations for one simulated period (t ≥ 1). */
function residuals(p: ISMPPCParams, s: PeriodState) {
  return {
    is: s.Y - (p.Ybar - p.alpha * (s.r - p.rho) + s.eps),
    fisher: s.r - (s.i - s.Enext),
    pc: s.pi - (s.Eprev + p.phi * (s.Y - p.Ybar) + s.nu),
    exp: s.Enext - (p.lambda * p.piStar + (1 - p.lambda) * s.pi),
    mp: s.i - (s.pi + p.rho + p.thPi * (s.pi - p.piStar) + p.thY * (s.Y - p.Ybar) + s.e),
  }
}

function checkAll(p: ISMPPCParams, start = steadyState(p), tol = 1e-9) {
  const { path } = simulate(start, p)
  for (let t = 1; t < path.length; t++) {
    const s = path[t]
    for (const [k, r] of Object.entries(residuals(p, s))) {
      if (!(Math.abs(r) < tol * Math.max(1, Math.abs(s.pi), Math.abs(s.Y)))) throw new Error(`t=${t} ${k} residual ${r}`)
    }
    // E_{t−1}π_t links consecutive periods (plus the one-off expectation shock in period 1).
    close(s.Eprev, path[t - 1].Enext + (t === 1 ? p.expShock : 0), 1e-12)
  }
  return path
}

describe('IS-MP-PC steady state', () => {
  it('defaults: Y = 100, π = 2, i = 4, r = 2 in every period without shocks', () => {
    const { path, stopped } = simulate(steadyState(D), D)
    expect(stopped).toBeNull()
    expect(path).toHaveLength(ISMPPC_HORIZON + 1)
    for (const s of path) {
      close(s.Y, 100)
      close(s.pi, 2)
      close(s.i, 4)
      close(s.r, 2)
    }
    const sol = ismppcModel.solve({ regime: 'taylor', values: {} })
    for (const k of ['Y0', 'Y1', 'YLR', 'YT']) close(sol.values[k], 100)
    for (const k of ['pi0', 'pi1', 'piLR', 'piT']) close(sol.values[k], 2)
    for (const k of ['i0', 'i1', 'iLR']) close(sol.values[k], 4)
    for (const k of ['r0', 'r1', 'rLR']) close(sol.values[k], 2)
    expect(sol.warnings).toEqual([])
    expect(sol.markers).toHaveLength(1)
    expect(sol.trajectory!.points).toHaveLength(ISMPPC_HORIZON + 1)
  })

  it('money is a locked outcome with an explanation and no invented value', () => {
    const locks = ismppcModel.lockedVariables('taylor')
    expect(locks.map((l) => l.key)).toEqual(['Mend'])
    expect(locks[0].reason).toContain('금리')
    expect(Number.isNaN(ismppcModel.solve({ regime: 'taylor', values: {} }).values.Mend)).toBe(true)
  })
})

describe('IS-MP-PC equations hold in every period', () => {
  const mixes: Partial<ISMPPCParams>[] = [
    { dG: 2 },
    { dG: -3, gMode: 1, gN: 5 },
    { eShock: 1, eMode: 2 },
    { nu: 1.5 },
    { nu: -1, nuMode: 1, nuN: 3, dG: 1, gMode: 2 },
    { expShock: 2, eShock: -0.5, eMode: 1, eN: 2 },
    { piStar: 0.5, nu: 0.75, nuMode: 2 },
    { thPi: -0.5, nu: 0.5 },
    { thPi: 0, dG: 1 },
    { alpha: 1.7, phi: 0.8, thY: 1.3, thPi: 1.4, dG: 4, nu: -2, expShock: 1 },
  ]
  for (const lambda of [0, 0.5, 1]) {
    for (const [j, mix] of mixes.entries()) {
      it(`λ = ${lambda}, mix ${j}`, () => {
        checkAll(P({ lambda, ...mix }))
      })
    }
  }

  it('also from a different baseline steady state (old π*, ρ, Ȳ)', () => {
    const p = P({ piStar: 1, rho: 3, Ybar: 104, lambda: 0.3, dG: 1 })
    checkAll(p, steadyState({ Ybar: 100, piStar: 2, rho: 2 }))
  })
})

describe('IS-MP-PC stability', () => {
  it('c at defaults = 1/(1 + 0.25·0.5/1.5) ≈ 0.923077; at θπ = −0.5 ≈ 1.090909', () => {
    close(coefficients(D).c, 1 / (1 + (0.25 * 0.5) / 1.5), 1e-12)
    close(coefficients(D).c, 0.923077, 1e-6)
    close(persistenceAdaptive(D), 0.923077, 1e-6)
    const bad = P({ thPi: -0.5 })
    close(coefficients(bad).c, 1.090909, 1e-6)
    close(persistenceAdaptive(bad), 1.090909, 1e-6)
    expect(stabilityOf(D).status).toBe('stable')
    expect(stabilityOf(bad).status).toBe('unstable')
    expect(stabilityOf(P({ thPi: 0 })).status).toBe('unit')
  })

  it('simulated ratio of successive inflation gaps after a one-period shock matches c (λ = 0)', () => {
    for (const thPi of [0.5, -0.5, 1.5, 0.1]) {
      const p = P({ thPi, nu: 1 })
      const { c } = coefficients(p)
      const { path } = simulate(steadyState(p), p, 20)
      for (let t = 2; t < path.length; t++) {
        close((path[t].pi - p.piStar) / (path[t - 1].pi - p.piStar), c, 1e-9)
      }
    }
  })

  it('stable case converges to the steady state by the horizon', () => {
    const { cur } = run({ dG: 3 })
    close(cur.values.YT, 100, 0.05)
    close(cur.values.piT, 2, 0.05)
    expect(cur.values.stability).toBe(1)
    expect(cur.warnings).toEqual([])
    const big = run({ nu: 2, lambda: 0.5 }).cur
    close(big.values.piT, 2, 1e-6)
  })

  it('unstable case diverges, stops before values become absurd and warns', () => {
    const grow = series(run({ thPi: -0.5, nu: 1 }).cur, 'pi')
    for (let t = 2; t <= ISMPPC_HORIZON; t++) expect(Math.abs(grow[t] - 2)).toBeGreaterThan(Math.abs(grow[t - 1] - 2))
    const { cur } = run({ thPi: -1, nu: 1 })
    expect(cur.values.stability).toBe(-1)
    const pis = series(cur, 'pi')
    expect(pis).toHaveLength(ISMPPC_HORIZON + 1)
    const finite = pis.filter(Number.isFinite)
    expect(finite.length).toBeGreaterThan(10)
    expect(finite.length).toBeLessThan(ISMPPC_HORIZON + 1)
    expect(Math.max(...finite.map((x) => Math.abs(x - 2)))).toBeLessThanOrEqual(50)
    for (let t = 2; t < finite.length; t++) expect(Math.abs(finite[t] - 2)).toBeGreaterThan(Math.abs(finite[t - 1] - 2))
    expect(pis.slice(finite.length).every(Number.isNaN)).toBe(true)
    expect(cur.warnings.some((w) => w.message.includes('불안정') && w.message.includes('테일러 원칙'))).toBe(true)
    expect(cur.trajectory!.fitUntil).toBeLessThanOrEqual(8)
    expect(cur.stability!.status).toBe('unstable')
    expect(Number.isFinite(cur.values.YLR)).toBe(false)
  })

  it('θπ = −0.5 with no shock stays at the steady state (no warning-only crash)', () => {
    const { cur } = run({ thPi: -0.5 })
    close(cur.values.YT, 100)
    expect(cur.warnings.some((w) => w.message.includes('불안정'))).toBe(true)
  })
})

describe('IS-MP-PC λ = 1 (fully anchored)', () => {
  it('after a one-period supply shock inflation and output return to target the next period', () => {
    const p = P({ lambda: 1, nu: 1 })
    expect(coefficients(p).c).toBe(0)
    const path = checkAll(p)
    expect(path[1].pi).toBeGreaterThan(2)
    expect(path[1].Y).toBeLessThan(100)
    for (let t = 2; t < path.length; t++) {
      close(path[t].pi, 2, 1e-12)
      close(path[t].Y, 100, 1e-12)
      close(path[t].i, 4, 1e-12)
    }
    // Impact: x₁ = ν / (1 + φ α (1 + θπ)/(1 + α θY)) = 1 / (1 + 0.25·1.5/1.5) = 0.8
    close(path[1].pi - 2, 0.8, 1e-12)
  })
})

describe('IS-MP-PC impact signs', () => {
  it('positive demand shock raises Y and π on impact', () => {
    const v = run({ dG: 2 }).cur.values
    expect(v.Y1).toBeGreaterThan(100)
    expect(v.pi1).toBeGreaterThan(2)
    expect(v.i1).toBeGreaterThan(4)
  })
  it('positive policy shock e lowers Y and π on impact', () => {
    const v = run({ eShock: 1 }).cur.values
    expect(v.Y1).toBeLessThan(100)
    expect(v.pi1).toBeLessThan(2)
    expect(v.r1).toBeGreaterThan(2)
  })
  it('positive supply shock raises π and lowers Y (stagflation)', () => {
    const { cur, base } = run({ nu: 1 })
    expect(cur.values.pi1).toBeGreaterThan(2)
    expect(cur.values.Y1).toBeLessThan(100)
    const text = ismppcModel.explain({ input: { regime: 'taylor', values: {} }, solution: base }, { input: { regime: 'taylor', values: { nu: 1 } }, solution: cur }).join(' ')
    expect(text).toContain('스태그플레이션')
  })
  it('a one-off expectation shock raises π and lowers Y in period 1 and persists when λ < 1', () => {
    const v = run({ expShock: 1 }).cur
    expect(v.values.pi1).toBeGreaterThan(2)
    expect(v.values.Y1).toBeLessThan(100)
    expect(series(v, 'pi')[2]).toBeGreaterThan(2)
  })
})

describe('IS-MP-PC disinflation', () => {
  for (const lambda of [0, 0.5, 0.9]) {
    it(`lower π* converges to the new target with output below Ȳ (λ = ${lambda})`, () => {
      const { cur } = run({ piStar: 1, lambda })
      const ys = series(cur, 'Y')
      const pis = series(cur, 'pi')
      close(ys[0], 100)
      close(pis[0], 2)
      close(pis[ISMPPC_HORIZON], 1, 0.05)
      close(cur.values.piLR, 1)
      for (let t = 1; t <= ISMPPC_HORIZON; t++) {
        // Strictly below Ȳ while the gap is visible; never above it.
        expect(ys[t] - 100).toBeLessThan(t <= 3 ? -1e-6 : 1e-12)
        expect(pis[t] - 1).toBeGreaterThan(t <= 3 ? 1e-6 : -1e-12)
      }
      expect(cur.values.sacrifice).toBeGreaterThan(0)
    })
  }
  it('anchoring lowers the sacrifice ratio', () => {
    const s0 = run({ piStar: 1, lambda: 0 }).cur.values.sacrifice
    const s5 = run({ piStar: 1, lambda: 0.5 }).cur.values.sacrifice
    expect(s5).toBeLessThan(s0)
  })
})

describe('IS-MP-PC long run with permanent shocks', () => {
  it('permanent demand shock at λ = 0: Y → Ȳ, π − π* → ε / (α θπ)', () => {
    const { cur } = run({ dG: 1, gMode: 2 })
    const lr = longRun(P({ dG: 1, gMode: 2 }))!
    close(lr.Y, 100)
    close(lr.pi, 2 + 1 / (1 * 0.5))
    close(cur.values.YT, lr.Y, 0.1)
    close(cur.values.piT, lr.pi, 0.1)
    expect(Math.abs(cur.values.piT - lr.pi)).toBeLessThan(Math.abs(series(cur, 'pi')[1] - lr.pi))
  })
  it('long run is a fixed point of the simulation for λ ∈ {0, 0.5}', () => {
    for (const lambda of [0, 0.5]) {
      const p = P({ lambda, nu: 1, nuMode: 2, eShock: 0.5, eMode: 2 })
      const lr = longRun(p)!
      const start: PeriodState = { t: 0, Eprev: lr.pi, eps: 0, e: 0, nu: 0, Y: lr.Y, pi: lr.pi, i: lr.i, r: lr.r, Enext: p.lambda * p.piStar + (1 - p.lambda) * lr.pi }
      const { path } = simulate(start, p, 5)
      for (const s of path.slice(1)) {
        close(s.Y, lr.Y, 1e-9)
        close(s.pi, lr.pi, 1e-9)
      }
    }
  })
})

describe('IS-MP-PC graph', () => {
  it('DAD slopes down when λ + θπ > 0, is vertical at 0 and slopes up when < 0; DAS slope φ', () => {
    const slope = (c: { points: { x: number; y: number }[] }) => {
      const [a, b] = c.points
      return (b.y - a.y) / (b.x - a.x)
    }
    const at = (v: Partial<ISMPPCParams>) => ismppcModel.solve({ regime: 'taylor', values: v as Record<string, number> }).curves
    const [dad, das] = at({})
    close(slope(dad), -1 / ((1 * 0.5) / 1.5), 1e-9)
    close(slope(das), 0.25, 1e-12)
    const vert = at({ thPi: 0 })[0]
    expect(vert.points[0].x).toBe(vert.points[1].x)
    expect(slope(at({ thPi: -0.5 })[0])).toBeGreaterThan(0)
  })
  it('trajectory curves follow the period: DAS shifts with expected inflation', () => {
    const s = run({ nu: 1 }).cur
    expect(s.trajectory!.curvesFollowPeriod).toBe(true)
    const das2 = s.trajectory!.curves[2].find((c) => c.id === 'DAS')!
    const p1 = series(s, 'pi')[1]
    // DAS₂ passes through (Ȳ, E₁π₂) = (100, π₁) under adaptive expectations.
    const [a, b] = das2.points
    close(a.y + ((b.y - a.y) * (100 - a.x)) / (b.x - a.x), p1, 1e-9)
    expect(s.markers!.map((m) => m.kind)).toEqual(['baseline', 'short'])
  })
  it('clipLine stays in the box', () => {
    const pts = clipLine({ x: 100, y: 2 }, -3, [94, 106], [-1, 6])
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(94 - 1e-9)
      expect(p.x).toBeLessThanOrEqual(106 + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1 - 1e-9)
      expect(p.y).toBeLessThanOrEqual(6 + 1e-9)
    }
  })
})

describe('IS-MP-PC properties', () => {
  const paramsArb = fc.record({
    alpha: fc.double({ min: 0.2, max: 2, noNaN: true }),
    phi: fc.double({ min: 0.05, max: 1, noNaN: true }),
    rho: fc.double({ min: 0, max: 5, noNaN: true }),
    Ybar: fc.double({ min: 90, max: 110, noNaN: true }),
    piStar: fc.double({ min: 0, max: 6, noNaN: true }),
    thPi: fc.double({ min: -1, max: 2, noNaN: true }),
    thY: fc.double({ min: 0, max: 2, noNaN: true }),
    lambda: fc.double({ min: 0, max: 1, noNaN: true }),
    dG: fc.double({ min: -5, max: 5, noNaN: true }),
    gMode: fc.constantFrom(0, 1, 2),
    gN: fc.integer({ min: 2, max: 20 }),
    eShock: fc.double({ min: -3, max: 3, noNaN: true }),
    eMode: fc.constantFrom(0, 1, 2),
    eN: fc.integer({ min: 2, max: 20 }),
    nu: fc.double({ min: -3, max: 3, noNaN: true }),
    nuMode: fc.constantFrom(0, 1, 2),
    nuN: fc.integer({ min: 2, max: 20 }),
    expShock: fc.double({ min: -3, max: 3, noNaN: true }),
  })

  it('all five equations hold in every simulated period', () => {
    fc.assert(
      fc.property(paramsArb, (p) => {
        if (stabilityOf(p).status === 'parallel') return
        checkAll(p, steadyState(p), 1e-9)
      }),
      { numRuns: 400 },
    )
  })

  it('stability classification agrees with simulated behaviour (one-period supply shock)', () => {
    fc.assert(
      fc.property(paramsArb, fc.double({ min: 0.25, max: 3, noNaN: true }), (raw, nu) => {
        const p: ISMPPCParams = { ...raw, dG: 0, eShock: 0, expShock: 0, nu, nuMode: 0 }
        const { c, status } = stabilityOf(p)
        if (status === 'parallel' || Math.abs(Math.abs(c) - 1) < 0.02) return
        const { path, stopped } = simulate(steadyState(p), p, 400)
        const gap = (t: number) => Math.abs(path[t].pi - p.piStar)
        if (status === 'stable') {
          expect(stopped).toBeNull()
          expect(gap(400)).toBeLessThan(gap(1) * 1e-2 + 1e-9)
        } else {
          expect(stopped).toBe('diverged')
          if (path.length > 2) expect(gap(path.length - 1)).toBeGreaterThan(gap(1))
        }
        const sol = ismppcModel.solve({ regime: 'taylor', values: p as unknown as Record<string, number> })
        expect(sol.warnings.some((w) => w.message.includes('불안정'))).toBe(status === 'unstable')
      }),
      { numRuns: 400 },
    )
  })
})
