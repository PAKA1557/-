import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ISLM_DEFAULTS,
  fiscalMultiplierMoney,
  islmModel,
  isRate,
  lmRate,
  moneyMultiplier,
  solveMoneyTarget,
  solveRateTarget,
  type ISLMParams,
} from './islm'

const D = ISLM_DEFAULTS
const close = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol)

describe('IS-LM analytic results at default parameters', () => {
  it('default equilibrium is Y* = 1100, i* = 6', () => {
    const e = solveMoneyTarget(D)
    close(e.Y, 1100)
    close(e.i, 6)
    close(e.r, 6)
    close(e.I, 50)
    close(e.C, 950)
    // goods-market identity Y = C + I + G
    close(e.C + e.I + D.G, e.Y)
  })

  it('numeric dY/dG equals 1/(1 − c1 + b1 k / h) = 2.0', () => {
    const dG = 1e-3
    const num = (solveMoneyTarget({ ...D, G: D.G + dG }).Y - solveMoneyTarget(D).Y) / dG
    close(num, 2, 1e-6)
    close(fiscalMultiplierMoney(D), 2)
  })

  it('numeric dY/dM = 0.25', () => {
    const dM = 1e-3
    const num = (solveMoneyTarget({ ...D, M: D.M + dM }).Y - solveMoneyTarget(D).Y) / dM
    close(num, 0.25, 1e-6)
    close(moneyMultiplier(D), 0.25)
  })

  it('πe +1 gives ΔY = +50, Δi = +0.5, Δr = −0.5', () => {
    const a = solveMoneyTarget(D)
    const b = solveMoneyTarget({ ...D, pe: 1 })
    close(b.Y - a.Y, 50)
    close(b.i - a.i, 0.5)
    close(b.r - a.r, -0.5)
  })

  it('model definition solve() agrees with the solver and reports locks', () => {
    const s = islmModel.solve({ regime: 'money', values: {} })
    close(s.values.Y, 1100)
    close(s.values.i, 6)
    expect(islmModel.lockedVariables('money').map((l) => l.key)).toEqual(['i'])
    expect(islmModel.lockedVariables('rate').map((l) => l.key)).toEqual(['M'])
    expect(s.warnings).toEqual([])
  })

  it('flags a negative nominal rate in money-target mode', () => {
    const s = islmModel.solve({ regime: 'money', values: { M: 1400, P: 1, G: 0, pe: -2 } })
    expect(s.values.i).toBeLessThan(0)
    expect(s.warnings.some((w) => w.key === 'i')).toBe(true)
  })
})

// Sane parameter ranges (match the UI sliders).
const params: fc.Arbitrary<ISLMParams> = fc.record({
  c0: fc.double({ min: 50, max: 400, noNaN: true }),
  c1: fc.double({ min: 0.5, max: 0.9, noNaN: true }),
  T: fc.double({ min: 0, max: 300, noNaN: true }),
  b0: fc.double({ min: 50, max: 400, noNaN: true }),
  b1: fc.double({ min: 5, max: 50, noNaN: true }),
  G: fc.double({ min: 0, max: 300, noNaN: true }),
  M: fc.double({ min: 600, max: 1400, noNaN: true }),
  P: fc.double({ min: 1, max: 4, noNaN: true }),
  k: fc.double({ min: 0.5, max: 1.5, noNaN: true }),
  h: fc.double({ min: 50, max: 200, noNaN: true }),
  pe: fc.double({ min: -2, max: 5, noNaN: true }),
  i: fc.double({ min: 0, max: 12, noNaN: true }),
})
const rel = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b))

describe('regime consistency', () => {
  it('feeding money-target i* into rate-target mode reproduces Y and M', () => {
    fc.assert(
      fc.property(params, (p) => {
        const money = solveMoneyTarget(p)
        const rate = solveRateTarget({ ...p, i: money.i })
        return rel(rate.Y, money.Y) && rel(rate.M, p.M) && rel(rate.I, money.I)
      }),
    )
  })

  it('at defaults: rate target i = 6 gives Y = 1100 and M = 1000', () => {
    const r = solveRateTarget({ ...D, i: 6 })
    close(r.Y, 1100)
    close(r.M, 1000)
  })
})

describe('property tests', () => {
  it('raising G never lowers Y (both regimes)', () => {
    fc.assert(
      fc.property(params, fc.double({ min: 0, max: 100, noNaN: true }), (p, dG) => {
        const q = { ...p, G: p.G + dG }
        return (
          solveMoneyTarget(q).Y >= solveMoneyTarget(p).Y - 1e-9 &&
          solveRateTarget(q).Y >= solveRateTarget(p).Y - 1e-9
        )
      }),
    )
  })

  it('raising M never raises i (money target)', () => {
    fc.assert(
      fc.property(params, fc.double({ min: 0, max: 400, noNaN: true }), (p, dM) => {
        return solveMoneyTarget({ ...p, M: p.M + dM }).i <= solveMoneyTarget(p).i + 1e-9
      }),
    )
  })

  it('curve points satisfy their equations; equilibrium lies on both curves', () => {
    fc.assert(
      fc.property(params, fc.constantFrom('money', 'rate'), (p, regime) => {
        const s = islmModel.solve({ regime, values: { ...p } }, { xDomain: [0, 3000] })
        const IS = s.curves.find((c) => c.id === 'IS')!
        const LM = s.curves.find((c) => c.id === 'LM')!
        const r = (i: number) => i - p.pe
        const isOk = IS.points.every(({ x: Y, y: i }) => {
          // Y = c0 + c1 (Y − T) + b0 − b1 r + G
          const rhs = p.c0 + p.c1 * (Y - p.T) + p.b0 - p.b1 * r(i) + p.G
          return Math.abs(rhs - Y) <= 1e-7 * Math.max(1, Math.abs(Y))
        })
        const lmOk = LM.points.every(({ x: Y, y: i }) =>
          regime === 'rate'
            ? i === p.i
            : Math.abs(p.M / p.P - (p.k * Y - p.h * i)) <= 1e-7 * Math.max(1, Math.abs(Y)),
        )
        const { x: Ye, y: ie } = s.equilibrium.point
        const onIS = rel(isRate(p, Ye), ie)
        const onLM = regime === 'rate' ? rel(ie, p.i) : rel(lmRate(p, Ye), ie)
        return isOk && lmOk && onIS && onLM
      }),
    )
  })
})

describe('explanations', () => {
  const base = { regime: 'money', values: {} }
  const run = (values: Record<string, number>, regime = 'money') => {
    const input = { regime, values }
    return islmModel.explain(
      { input: base, solution: islmModel.solve(base) },
      { input, solution: islmModel.solve(input) },
    )
  }

  it('describes the fiscal crowding-out chain', () => {
    const text = run({ G: 150 }).join(' ')
    expect(text).toContain('재정지출 증가 → IS 곡선이 오른쪽으로 이동 → 산출과 금리 상승')
    expect(text).toContain('구축효과')
  })

  it('says nothing changed at baseline', () => {
    expect(run({})).toHaveLength(1)
    expect(run({})[0]).toContain('기준점과 같습니다')
  })

  it('explains a rate hike in rate-target mode', () => {
    const text = run({ i: 7 }, 'rate').join(' ')
    expect(text).toContain('기준금리 인상')
  })
})

describe('model definition edge cases', () => {
  it.each([
    { i: 8, M: 200, warns: false },
    { i: 8.5, M: 0, warns: true },
    { i: 9, M: -200, warns: true },
  ])('rate target i = $i produces M = $M and money warning = $warns', ({ i, M, warns }) => {
    const s = islmModel.solve({ regime: 'rate', values: { i } })

    expect(s.values.M).toBe(M)
    expect(s.warnings.some((w) => w.key === 'M' && w.message.length > 0)).toBe(warns)
  })

  it.each([
    { M: 3200, i: 0.5, warns: false },
    { M: 3400, i: 0, warns: false },
    { M: 3600, i: -0.5, warns: true },
  ])('money target M = $M produces i = $i and rate warning = $warns', ({ M, i, warns }) => {
    const s = islmModel.solve({ regime: 'money', values: { M } })

    expect(s.values.i).toBe(i)
    expect(s.warnings.some((w) => w.key === 'i' && w.message.length > 0)).toBe(warns)
  })

  describe.each(['money', 'rate'])('%s regime curve endpoints', (regime) => {
    it.each<[number, number]>([
      [-125.5, 2325.5],
      [800, 900],
      [1200, 1200],
    ])('respects xDomain [%s, %s]', (x0, x1) => {
      const s = islmModel.solve({ regime, values: {} }, { xDomain: [x0, x1] })

      expect(s.curves.map((c) => c.id)).toEqual(['IS', 'LM'])
      for (const curve of s.curves) {
        expect(curve.points[0].x).toBe(x0)
        expect(curve.points[curve.points.length - 1].x).toBe(x1)
        expect(curve.points.every(({ x }) => x >= x0 && x <= x1)).toBe(true)
      }
    })
  })

  it.each([
    { regime: 'money', key: 'i' },
    { regime: 'rate', key: 'M' },
  ])('locks $key in the $regime regime', ({ regime, key }) => {
    const locks = islmModel.lockedVariables(regime)

    expect(locks.map((lock) => lock.key)).toEqual([key])
    expect(locks[0].resultKey).toBe(key)
    expect(locks[0].reason.length).toBeGreaterThan(0)
  })
})
