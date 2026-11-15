import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { determinacy, NK_DEFAULTS, NK_HORIZON, nkModel, shockCoefficients, solveNKPeriod, type NKParams } from './nk'
import type { Point } from './types'

const P = (over: Partial<NKParams> = {}): NKParams => ({ ...NK_DEFAULTS, ...over })
const run = (values: Partial<NKParams> = {}) => nkModel.solve({ regime: 'taylor', values: values as Record<string, number> })
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9)
const double = (min: number, max: number) => fc.double({ min, max, noNaN: true })
const params = fc.record({
  phiPi: double(0, 3), phiX: double(0, 2), beta: double(0.9, 0.999),
  sigma: double(0.2, 3), kappa: double(0.02, 1), piStar: double(0, 6), rn: double(0, 5),
  d: double(-3, 3), u: double(-3, 3), v: double(-3, 3),
  rhoD: double(0, 0.95), rhoU: double(0, 0.95), rhoV: double(0, 0.95),
}).filter((p) => determinacy(p) > 1e-5)

describe('New Keynesian steady state and shocks', () => {
  it('has Y = 100, π = 2, i = 4, r = 2 in all 41 periods at defaults', () => {
    const s = run()
    expect(s.warnings).toEqual([])
    expect(s.stability).toMatchObject({ status: 'stable', value: '0.170' })
    for (const path of s.timePaths!) {
      expect(path.values).toHaveLength(NK_HORIZON + 1)
      const value = { Y: 100, pi: 2, i: 4, r: 2 }[path.key]!
      path.values.forEach((v) => close(v, value))
    }
    expect(s.values).toMatchObject({ Y1: 100, pi1: 2, i1: 4, r1: 2, YLR: 100, piLR: 2 })
    expect(nkModel.lockedVariables('taylor')[0].reason).toContain('결과값')
    expect(Number.isNaN(s.values.Mend)).toBe(true)
  })

  it.each([
    ['d', 1, 1], ['u', -1, 1], ['v', -1, -1],
  ] as const)('%s has the expected output and inflation signs', (key, xSign, piSign) => {
    const s = solveNKPeriod(P({ [key]: 1 }), 1)!
    expect(s.x * xSign).toBeGreaterThan(0)
    expect((s.pi - 2) * piSign).toBeGreaterThan(0)
  })

  it('returns exactly to steady state in period 2 with zero persistence', () => {
    const p = P({ d: 2, u: -1, v: 0.75, rhoD: 0, rhoU: 0, rhoV: 0 })
    for (let t = 2; t <= NK_HORIZON; t++) {
      expect(solveNKPeriod(p, t)).toMatchObject({ x: 0, Y: 100, pi: 2, i: 4, r: 2 })
    }
  })

  it('a stronger inflation response dampens demand and monetary inflation responses', () => {
    for (const key of ['d', 'v'] as const) {
      const weak = solveNKPeriod(P({ [key]: 1, phiPi: 1.1 }), 1)!
      const strong = solveNKPeriod(P({ [key]: 1, phiPi: 2.5 }), 1)!
      expect(Math.abs(strong.pi - 2)).toBeLessThan(Math.abs(weak.pi - 2))
    }
  })

  it('cost-push stabilization entails a larger output loss', () => {
    const weak = solveNKPeriod(P({ u: 1, phiPi: 1.1 }), 1)!
    const strong = solveNKPeriod(P({ u: 1, phiPi: 2.5 }), 1)!
    expect(strong.pi).toBeLessThan(weak.pi)
    expect(strong.x).toBeLessThan(weak.x)
  })
})

describe('New Keynesian rational expectations solution', () => {
  it('satisfies all three equations and forward expectations in every post-shock period', () => {
    fc.assert(fc.property(params, (p) => {
      for (let t = 1; t <= NK_HORIZON; t++) {
        const s = solveNKPeriod(p, t)!
        const next = solveNKPeriod(p, t + 1)!
        close(s.ExNext, next.x)
        close(s.EpiNext, next.pi)
        close(s.x, s.ExNext - p.sigma * (s.i - s.EpiNext - p.rn) + s.d)
        close(s.pi - p.piStar, p.beta * (s.EpiNext - p.piStar) + p.kappa * s.x + s.u)
        close(s.i, p.rn + p.piStar + p.phiPi * (s.pi - p.piStar) + p.phiX * s.x + s.v)
        close(s.r, s.i - s.EpiNext)
      }
    }), { numRuns: 500 })
  })

  it('does not select an arbitrary equilibrium when indeterminate or on the boundary', () => {
    for (const [phiPi, status] of [[0.8, 'unstable'], [1, 'unit']] as const) {
      const s = run({ phiPi, phiX: 0, d: 1 })
      expect(s.stability!.status).toBe(status)
      expect(s.warnings.length).toBeGreaterThan(0)
      expect(s.timePaths!.every((p) => p.values.slice(1).every(Number.isNaN))).toBe(true)
      expect(s.trajectory!.curves.slice(1).every((c) => c.length === 0)).toBe(true)
      expect(Number.isNaN(s.values.YLR)).toBe(true)
    }
    expect(run({ phiPi: 0.8, phiX: 0 }).warnings[0].message).toContain('유일한 균형이 없음(비결정성)')
  })

  it('rejects singular shock coefficient systems', () => {
    // rho = 0, phiX = 0, sigma = kappa = 1 → det = 1 + phiPi.
    const p = P({ phiX: 0, sigma: 1, kappa: 1, phiPi: -1, rhoD: 0 })
    expect(shockCoefficients(p, 'd', 0)).toBeNull()
    expect(run(p).warnings.some((w) => w.message.includes('행렬식'))).toBe(true)
  })

  it('period 0 uses the saved baseline steady state while new targets apply immediately from period 1', () => {
    const baseline = run({ piStar: 3, rn: 1 })
    const s = nkModel.solve({ regime: 'taylor', values: { piStar: 1, rn: 2 } }, { baseline })
    expect(s.values).toMatchObject({ pi0: 3, r0: 1, pi1: 1, r1: 2, Y1: 100 })
  })

  it('AD and NKPC intersect at the reported equilibrium in every period', () => {
    const lineResidual = (a: Point, b: Point, p: Point) =>
      ((p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y)
    fc.assert(fc.property(params, (p) => {
      const s = run(p)
      expect(s.trajectory!.curvesFollowPeriod).toBe(true)
      for (let t = 0; t <= NK_HORIZON; t++) {
        const curves = s.trajectory!.curves[t]
        expect(curves.map((c) => c.id)).toEqual(['AD', 'NKPC'])
        for (const c of curves) close(lineResidual(c.points[0], c.points[1], s.trajectory!.points[t]), 0)
      }
    }), { numRuns: 200 })
  })

  it('supports the determinate vertical-AD edge case φπ = 0', () => {
    const s = run({ phiPi: 0, beta: 0.9, kappa: 0.02, phiX: 2, d: 1 })
    expect(s.stability!.status).toBe('stable')
    const ad = s.curves[0]
    close(ad.points[0].x, ad.points[1].x)
    close(ad.points[0].x, s.values.Y1)
  })
})
