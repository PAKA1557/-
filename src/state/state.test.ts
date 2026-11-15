import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { islmModel } from '../engine/islm'
import { clampTo, initialState, reducer, type ScenarioState } from './scenario'
import { parse, serialize } from './url'

const valuesArb = fc.record(
  Object.fromEntries(
    islmModel.variables.map((v) => [v.key, fc.oneof(fc.constant(v.default), fc.double({ min: v.min, max: v.max, noNaN: true }).map((x) => clampTo(v, x)))]),
  ) as Record<string, fc.Arbitrary<number>>,
)
const regimeArb = fc.constantFrom('money', 'rate')
const stateArb: fc.Arbitrary<ScenarioState> = fc.record({
  model: fc.constant('islm' as const),
  regime: regimeArb,
  values: valuesArb,
  baseline: fc.record({ regime: regimeArb, values: valuesArb }),
})

describe('URL serialization', () => {
  it('default state serializes to an empty query', () => {
    expect(serialize(initialState())).toBe('')
    expect(parse('')).toEqual(initialState())
  })

  it('serialize → parse round-trips', () => {
    fc.assert(fc.property(stateArb, (s) => {
      expect(parse(serialize(s))).toEqual(s)
    }), { numRuns: 1000 })
  })

  it('accepts a leading "?", ignores junk and clamps out-of-range values', () => {
    const s = parse('?G=99999&M=abc&zzz=1&regime=nope&b.i=-5')
    expect(s.values.G).toBe(300)
    expect(s.values.M).toBe(1000)
    expect(s.regime).toBe('money')
    expect(s.baseline.values.i).toBe(0)
  })
})

describe('reducer', () => {
  it('regime switch carries the equilibrium over so Y does not jump', () => {
    let s = reducer(initialState(), { type: 'set', key: 'G', value: 150 })
    const before = islmModel.solve(s).values
    s = reducer(s, { type: 'regime', regime: 'rate' })
    expect(s.values.i).toBeCloseTo(before.i, 9)
    expect(islmModel.solve(s).values.Y).toBeCloseTo(before.Y, 9)
    s = reducer(s, { type: 'regime', regime: 'money' })
    expect(s.values.M).toBeCloseTo(1000, 9)
  })

  it('saveBaseline copies current state; reset restores defaults', () => {
    let s = reducer(initialState(), { type: 'set', key: 'G', value: 200 })
    s = reducer(s, { type: 'saveBaseline' })
    expect(s.baseline.values.G).toBe(200)
    expect(reducer(s, { type: 'reset' })).toEqual(initialState())
  })

  it('ignores unknown variables and unimplemented models', () => {
    const s = initialState()
    expect(reducer(s, { type: 'set', key: 'nope', value: 1 })).toBe(s)
    expect(reducer(s, { type: 'model', model: 'adas' })).toBe(s)
  })
})
