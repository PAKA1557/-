import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { initialState, sharedKeys, type ScenarioState } from '../state/scenario'
import { parse, serialize } from '../state/url'
import { adasModel } from './adas'
import { islmModel } from './islm'
import { ismppcModel } from './ismppc'
import {
  betaOf,
  determinacy,
  determinacyOf,
  lambdaOf,
  NK_DEFAULTS,
  NK_HORIZON,
  nkModel,
  simulate,
  steadyState,
  YBAR,
  type NKParams,
  type PeriodState,
} from './nk'
import type { Curve, Solution } from './types'

const D = NK_DEFAULTS
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)
const P = (over: Partial<NKParams> = {}): NKParams => ({ ...D, ...over })

/** Solve a scenario against a baseline, as the UI does. */
function run(values: Partial<NKParams>, baseValues: Partial<NKParams> = {}) {
  const base = nkModel.solve({ regime: 'taylor', values: baseValues as Record<string, number> })
  const cur = nkModel.solve({ regime: 'taylor', values: values as Record<string, number> }, { baseline: base })
  return { base, cur }
}
const series = (s: Solution, key: string) => s.timePaths!.find((p) => p.key === key)!.values
const explainOf = (values: Partial<NKParams>, baseValues: Partial<NKParams> = {}) => {
  const { base, cur } = run(values, baseValues)
  return nkModel
    .explain(
      { input: { regime: 'taylor', values: baseValues as Record<string, number> }, solution: base },
      { input: { regime: 'taylor', values: values as Record<string, number> }, solution: cur },
    )
    .join(' ')
}

/**
 * Residuals of DIS, NKPC, MP and Fisher in period t ≥ 1, with next period's
 * simulated values as expectations (the stored analytic continuation for the last period).
 */
function residuals(p: NKParams, path: PeriodState[], t: number) {
  const s = path[t]
  const next = path[t + 1]
  const Ex = next ? next.x : s.Ex
  const Epi = next ? next.pi : s.Epi
  const beta = betaOf(p.rnat)
  return {
    dis: s.x - (Ex - (s.i - Epi - p.rnat - s.rn) / (4 * p.sigma)),
    nkpc: s.pi - p.target - (beta * (Epi - p.target) + p.kappa * s.x + s.u),
    mp: s.i - (p.rnat + p.target + p.phiPi * (s.pi - p.target) + p.phiX * s.x + s.v),
    fisher: s.r - (s.i - Epi),
    // Expectations are consistent with the simulated path.
    ex: next ? s.Ex - next.x : 0,
    epi: next ? s.Epi - next.pi : 0,
  }
}

function checkAll(p: NKParams, tol = 1e-9, allowStop = false) {
  const { path, stopped } = simulate(steadyState(p), p)
  // Extreme corners (κ small, ρz near 1) can push a gap past the reporting limit; the reported periods must still solve the model.
  if (allowStop) expect(stopped === null || stopped === 'diverged').toBe(true)
  else expect(stopped).toBeNull()
  for (let t = 1; t < path.length; t++) {
    const scale = Math.max(1, Math.abs(path[t].pi), Math.abs(path[t].x), Math.abs(path[t].i))
    for (const [k, r] of Object.entries(residuals(p, path, t))) {
      if (!(Math.abs(r) < tol * scale)) throw new Error(`t=${t} ${k} residual ${r}`)
    }
  }
  return path
}

/** Height of a (non-vertical) line at x, or its x for a vertical line. */
function lineAt(c: Curve, x: number): number {
  const [a, b] = c.points
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
}

describe('New Keynesian steady state', () => {
  it('defaults: Y = 100, π = 2, i = 4, r = 2 in every period; no warnings; one marker; 41 points', () => {
    const { path, stopped } = simulate(steadyState(D), D)
    expect(stopped).toBeNull()
    expect(path).toHaveLength(NK_HORIZON + 1)
    for (const s of path) {
      close(s.Y, 100)
      close(s.pi, 2)
      close(s.i, 4)
      close(s.r, 2)
    }
    const sol = nkModel.solve({ regime: 'taylor', values: {} })
    for (const k of ['Y0', 'Y1', 'YLR', 'YT']) close(sol.values[k], 100)
    for (const k of ['pi0', 'pi1', 'piLR', 'piT']) close(sol.values[k], 2)
    for (const k of ['i0', 'i1', 'iLR']) close(sol.values[k], 4)
    for (const k of ['r0', 'r1', 'rLR']) close(sol.values[k], 2)
    expect(sol.warnings).toEqual([])
    expect(sol.markers).toHaveLength(1)
    expect(sol.trajectory!.points).toHaveLength(NK_HORIZON + 1)
    expect(sol.values.stability).toBe(1)
    expect(sol.stability!.statusLabel).toBe('결정')
    close(sol.values.beta, 1 / 1.005, 1e-15)
  })

  it('money is a locked outcome with an explanation and no invented value', () => {
    const locks = nkModel.lockedVariables('taylor')
    expect(locks.map((l) => l.key)).toEqual(['Mnk'])
    expect(locks[0].reason).toContain('금리')
    expect(Number.isNaN(nkModel.solve({ regime: 'taylor', values: {} }).values.Mnk)).toBe(true)
  })

  it('with nothing changed, the explanation invites the student to try a shock', () => {
    expect(explainOf({})).toContain('정상상태')
  })
})

describe('New Keynesian equations hold in every period', () => {
  const mixes: Partial<NKParams>[] = [
    { uShock: 1 },
    { dRn: 2, rhoRn: 0.9 },
    { vShock: -1.5, rhoV: 0 },
    { uShock: -2, rhoU: 0.95, dRn: 1, rhoRn: 0.2, vShock: 0.75, rhoV: 0.6 },
    { uShock: 1, phiPi: 3, phiX: 0, sigma: 5, kappa: 0.05, rnat: 0.25 },
    { dRn: -3, phiPi: 1.1, phiX: 2, sigma: 0.5, kappa: 2, rnat: 5, target: 0 },
  ]
  for (const [j, mix] of mixes.entries()) {
    it(`mix ${j}`, () => {
      checkAll(P(mix))
    })
  }

  it('property: random determinate parameters and shocks', () => {
    const arb = fc.record({
      dRn: fc.double({ min: -3, max: 3, noNaN: true }),
      rhoRn: fc.double({ min: 0, max: 0.95, noNaN: true }),
      phiPi: fc.double({ min: 0, max: 3, noNaN: true }),
      phiX: fc.double({ min: 0, max: 2, noNaN: true }),
      vShock: fc.double({ min: -3, max: 3, noNaN: true }),
      rhoV: fc.double({ min: 0, max: 0.95, noNaN: true }),
      target: fc.double({ min: 0, max: 6, noNaN: true }),
      uShock: fc.double({ min: -3, max: 3, noNaN: true }),
      rhoU: fc.double({ min: 0, max: 0.95, noNaN: true }),
      sigma: fc.double({ min: 0.5, max: 5, noNaN: true }),
      kappa: fc.double({ min: 0.05, max: 2, noNaN: true }),
      rnat: fc.double({ min: 0.25, max: 5, noNaN: true }),
    })
    fc.assert(
      fc.property(arb, (p) => {
        fc.pre(determinacy(p) > 1e-3)
        checkAll(p, 1e-9, true)
      }),
      { numRuns: 400 },
    )
  })
})

describe('New Keynesian impact signs at defaults', () => {
  it('cost push u > 0: π₁ > 2, Y₁ < 100 (stagflation, trade-off)', () => {
    const v = run({ uShock: 1 }).cur.values
    expect(v.pi1).toBeGreaterThan(2)
    expect(v.Y1).toBeLessThan(100)
    const text = explainOf({ uShock: 1 })
    expect(text).toContain('스태그플레이션')
    expect(text).toContain('상충')
    expect(text).toContain('IS-MP-PC')
  })
  it('demand r̃ > 0: both up, no trade-off', () => {
    const v = run({ dRn: 1 }).cur.values
    expect(v.pi1).toBeGreaterThan(2)
    expect(v.Y1).toBeGreaterThan(100)
    expect(explainOf({ dRn: 1 })).toContain('상충이 없습니다')
  })
  it('policy v > 0: both down and the real rate rises above ρ', () => {
    const v = run({ vShock: 1 }).cur.values
    expect(v.pi1).toBeLessThan(2)
    expect(v.Y1).toBeLessThan(100)
    expect(v.r1).toBeGreaterThan(2)
  })
})

describe('New Keynesian closed form', () => {
  it('defaults with u = 1, ρu = 0.5: x₁ = −1/Λ, π̂₁ = 2.5/Λ', () => {
    const beta = 1 / 1.005
    const L = 2.5 * (1 - 0.5 * beta) + 0.5
    close(lambdaOf(P(), 0.5), L, 1e-12)
    const v = run({ uShock: 1, rhoU: 0.5 }).cur.values
    close(v.Y1 - 100, -1 / L, 1e-12)
    close(v.pi1 - 2, 2.5 / L, 1e-12)
    close(v.pi1, 3.4235, 1e-4)
    close(v.Y1, 99.4306, 1e-4)
  })

  it('no intrinsic persistence: with ρz = 0 the economy is back at the steady state in period 2', () => {
    for (const mix of [{ uShock: 2, rhoU: 0 }, { dRn: -1, rhoRn: 0 }, { vShock: 1, rhoV: 0 }]) {
      const s = run(mix).cur
      const [Y, pi, i, r] = ['Y', 'pi', 'i', 'r'].map((k) => series(s, k))
      expect(Math.abs(Y[1] - 100) + Math.abs(pi[1] - 2)).toBeGreaterThan(1e-3)
      for (let t = 2; t <= NK_HORIZON; t++) {
        expect(Y[t]).toBe(100)
        expect(pi[t]).toBe(2)
        close(i[t], 4, 1e-12)
        close(r[t], 2, 1e-12)
      }
    }
  })

  it('with ρz > 0 each gap at t + 1 is ρz times the gap at t (single shock)', () => {
    for (const [mix, rz] of [
      [{ uShock: 1, rhoU: 0.7 }, 0.7],
      [{ dRn: 2, rhoRn: 0.3 }, 0.3],
      [{ vShock: -1, rhoV: 0.9 }, 0.9],
    ] as const) {
      const { path } = simulate(steadyState(D), P(mix))
      for (let t = 1; t < NK_HORIZON; t++) {
        close(path[t + 1].x, rz * path[t].x, 1e-12)
        close(path[t + 1].piHat, rz * path[t].piHat, 1e-12)
      }
    }
  })

  it('linearity: all three shocks together = sum of the single-shock deviations', () => {
    const mix = { uShock: 1.25, rhoU: 0.6, dRn: -2, rhoRn: 0.85, vShock: 0.5, rhoV: 0.2 }
    const all = run(mix).cur
    const parts = [run({ uShock: 1.25, rhoU: 0.6 }).cur, run({ dRn: -2, rhoRn: 0.85 }).cur, run({ vShock: 0.5, rhoV: 0.2 }).cur]
    const ss: Record<string, number> = { Y: 100, pi: 2, i: 4, r: 2 }
    for (const k of ['Y', 'pi', 'i', 'r']) {
      const a = series(all, k)
      for (let t = 0; t <= NK_HORIZON; t++) {
        const sum = parts.reduce((acc, s) => acc + series(s, k)[t] - ss[k], 0)
        close(a[t] - ss[k], sum, 1e-10)
      }
    }
  })
})

describe('New Keynesian credible disinflation', () => {
  it('lowering π* from 4 to 2: period 0 at π = 4, i = 6; periods 1…40 at π = 2, Y = 100, i = 4', () => {
    const { cur } = run({ target: 2 }, { target: 4 })
    const [Y, pi, i] = ['Y', 'pi', 'i'].map((k) => series(cur, k))
    close(Y[0], 100)
    close(pi[0], 4)
    close(i[0], 6)
    for (let t = 1; t <= NK_HORIZON; t++) {
      close(Y[t], 100, 1e-12)
      close(pi[t], 2, 1e-12)
      close(i[t], 4, 1e-12)
    }
    expect(cur.warnings).toEqual([])
    expect(cur.markers!.map((m) => m.label)).toEqual(['E₀', 'E₁', 'E*'])
    const text = explainOf({ target: 2 }, { target: 4 })
    expect(text).toContain('희생률 0')
    expect(text).toContain('IS-MP-PC')
  })
})

describe('New Keynesian determinacy', () => {
  it('status matches the sign of κ(φπ − 1) + (1 − β)φx', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        fc.double({ min: 0.25, max: 5, noNaN: true }),
        (phiPi, phiX, kappa, rnat) => {
          const p = P({ phiPi, phiX, kappa, rnat, uShock: 1 })
          const det = kappa * (phiPi - 1) + (1 - 1 / (1 + rnat / 400)) * phiX
          const { status } = determinacyOf(p)
          expect(status).toBe(det > 1e-9 ? 'determinate' : det < -1e-9 ? 'indeterminate' : 'borderline')
          const sol = nkModel.solve({ regime: 'taylor', values: p as unknown as Record<string, number> })
          expect(sol.warnings.some((w) => w.message.includes('비결정'))).toBe(status === 'indeterminate')
          expect(sol.stability!.statusLabel).toBe(sol.values.stability === -2 ? '해 없음' : status === 'determinate' ? '결정' : status === 'borderline' ? '경계' : '비결정')
          if (status !== 'determinate') expect(sol.trajectory!.fitUntil).toBeLessThanOrEqual(8)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('φπ = 0.8 at defaults is indeterminate, warns, and still draws the MSV path', () => {
    const { cur } = run({ phiPi: 0.8, uShock: 1 })
    expect(cur.values.stability).toBe(-1)
    expect(cur.stability!.status).toBe('unstable')
    expect(cur.stability!.statusLabel).toBe('비결정')
    expect(cur.warnings.some((w) => w.message.includes('비결정') && w.message.includes('테일러 원칙'))).toBe(true)
    expect(series(cur, 'pi').every(Number.isFinite)).toBe(true)
    expect(Number.isNaN(cur.values.YLR)).toBe(true)
    expect(cur.markers!.some((m) => m.kind === 'long')).toBe(false)
    expect(cur.trajectory!.fitUntil).toBe(8)
    expect(explainOf({ phiPi: 0.8, uShock: 1 })).toContain('하나일 뿐')
  })

  it('φπ = 1 with φx = 0 is borderline', () => {
    const { cur } = run({ phiPi: 1, phiX: 0 })
    expect(cur.values.det).toBe(0)
    expect(cur.values.stability).toBe(0)
    expect(cur.stability!.statusLabel).toBe('경계')
    expect(cur.warnings.some((w) => w.message.includes('경계'))).toBe(true)
  })

  it('Λ = 0 for an active shock: no MSV solution, path stops after period 0', () => {
    // Λ(0.95) = 0 with σ = 0.5, φx = 0, κ = 2 at φπ = 0.95 − 0.05·2·(1 − 0.95β)/2.
    const beta = betaOf(2)
    const phiPi = 0.95 - (0.05 * 2 * (1 - 0.95 * beta)) / 2
    const vals = { sigma: 0.5, phiX: 0, kappa: 2, phiPi, uShock: 1, rhoU: 0.95 }
    expect(Math.abs(lambdaOf(P(vals), 0.95))).toBeLessThan(1e-12)
    const { cur } = run(vals)
    expect(cur.values.stability).toBe(-2)
    expect(cur.values.periods).toBe(0)
    expect(cur.trajectory!.points).toHaveLength(1)
    expect(series(cur, 'pi').slice(1).every(Number.isNaN)).toBe(true)
    expect(cur.warnings.some((w) => w.message.includes('해 없음'))).toBe(true)
    // The same rule without that shock still has a (steady-state) path.
    expect(run({ ...vals, uShock: 0 }).cur.values.periods).toBe(NK_HORIZON)
  })

  it('negative nominal rate warns about the effective lower bound', () => {
    const { cur } = run({ dRn: -3, rhoRn: 0.9 })
    expect(cur.values.i1).toBeLessThan(0)
    expect(cur.warnings.some((w) => w.message.includes('실효하한'))).toBe(true)
  })
})

describe('New Keynesian graph', () => {
  it('AD and NKPC pass through each period’s equilibrium', () => {
    for (const mix of [{ uShock: 2, rhoU: 0.7 }, { dRn: 1.5, vShock: -0.5, uShock: -1 }, { target: 3, uShock: 1 }, { phiPi: 0, phiX: 1, dRn: 1 }]) {
      const s = run(mix).cur
      expect(s.trajectory!.curvesFollowPeriod).toBe(true)
      s.trajectory!.points.forEach((pt, t) => {
        const cs = s.trajectory!.curves[t]
        const nkpc = cs.find((c) => c.id === 'NKPC')!
        const ad = cs.find((c) => c.id === 'AD')!
        close(lineAt(nkpc, pt.x), pt.y, 1e-9)
        if (ad.points[0].x === ad.points[1].x) close(ad.points[0].x, pt.x, 1e-9)
        else close(lineAt(ad, pt.x), pt.y, 1e-9)
      })
      expect(s.curves.map((c) => c.id)).toEqual(['AD', 'NKPC', 'LRAS'])
      expect(s.curves[2].points.every((p) => p.x === YBAR)).toBe(true)
    }
  })

  it('AD is vertical when φπ = 0; slopes −(4σ + φx)/φπ otherwise; NKPC slope κ', () => {
    const slope = (c: Curve) => (c.points[1].y - c.points[0].y) / (c.points[1].x - c.points[0].x)
    const [ad, nkpc] = nkModel.solve({ regime: 'taylor', values: {} }).curves
    close(slope(ad), -(4 + 0.5) / 1.5, 1e-9)
    close(slope(nkpc), 0.5, 1e-12)
    const vert = nkModel.solve({ regime: 'taylor', values: { phiPi: 0 } }).curves[0]
    expect(vert.points[0].x).toBe(vert.points[1].x)
  })
})

describe('New Keynesian state', () => {
  it('shares no variable keys with the other three models', () => {
    for (const other of [islmModel, adasModel, ismppcModel]) {
      expect(sharedKeys(nkModel, other)).toEqual([])
      expect(sharedKeys(other, nkModel)).toEqual([])
    }
  })

  it('URL round-trip for an NK state', () => {
    expect(serialize(initialState('nk'))).toBe('model=nk')
    const s: ScenarioState = {
      ...initialState('nk'),
      values: { ...initialState('nk').values, uShock: 2, rhoU: 0.7, phiPi: 0.8, target: 3.5, sigma: 2.25 },
      baseline: { regime: 'taylor', values: { ...initialState('nk').values, target: 4 } },
    }
    const q = serialize(s)
    expect(new URLSearchParams(q).get('model')).toBe('nk')
    expect(parse(q)).toEqual(s)
    expect(parse('?model=nk&uShock=1').values.uShock).toBe(1)
  })
})
