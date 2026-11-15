import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { adasModel } from '../engine/adas'
import { islmModel } from '../engine/islm'
import type { ModelDefinition } from '../engine/types'
import { clampTo, initialState, reducer, type ScenarioState } from './scenario'
import { parse, serialize } from './url'

const valuesArb = (model: ModelDefinition) =>
  fc.record(
    Object.fromEntries(
      model.variables.map((v) => [v.key, fc.oneof(fc.constant(v.default), fc.double({ min: v.min, max: v.max, noNaN: true }).map((x) => clampTo(v, x)))]),
    ) as Record<string, fc.Arbitrary<number>>,
  )
const regimeArb = fc.constantFrom('money', 'rate')
const stateArbFor = (model: ModelDefinition): fc.Arbitrary<ScenarioState> =>
  fc.record({
    model: fc.constant(model.id),
    regime: regimeArb,
    values: valuesArb(model),
    baseline: fc.record({ regime: regimeArb, values: valuesArb(model) }),
  })
const stateArb = stateArbFor(islmModel)

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

  it('serialize → parse round-trips for AD-AS, including the model id', () => {
    fc.assert(fc.property(stateArbFor(adasModel), (s) => {
      const q = serialize(s)
      expect(new URLSearchParams(q).get('model')).toBe('adas')
      expect(parse(q)).toEqual(s)
    }), { numRuns: 500 })
    expect(serialize(initialState('adas'))).toBe('model=adas')
    expect(parse('?model=adas').model).toBe('adas')
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
    expect(reducer(s, { type: 'model', model: 'ismppc' })).toBe(s)
    expect(reducer(s, { type: 'model', model: 'islm' })).toBe(s)
  })

  it('switching tabs keeps shared values and the regime; model-only variables take defaults', () => {
    let s = reducer(initialState(), { type: 'set', key: 'G', value: 150 })
    s = reducer(s, { type: 'set', key: 'pe', value: 1 })
    s = reducer(s, { type: 'set', key: 'P', value: 3 })
    s = reducer(s, { type: 'regime', regime: 'rate' })
    const a = reducer(s, { type: 'model', model: 'adas' })
    expect(a.model).toBe('adas')
    expect(a.regime).toBe('rate')
    expect(a.values.G).toBe(150)
    expect(a.values.pe).toBe(1)
    expect(a.values.i).toBe(s.values.i)
    expect(a.values.a).toBe(100)
    expect(a.values.Yn).toBe(1100)
    expect('P' in a.values).toBe(false)
    expect(a.baseline.values.G).toBe(100)
    const back = reducer(reducer(a, { type: 'set', key: 'M', value: 1200 }), { type: 'model', model: 'islm' })
    expect(back.values.G).toBe(150)
    expect(back.values.M).toBe(1200)
    expect(back.values.P).toBe(2)
    expect(back.regime).toBe('rate')
    expect(parse(serialize(back))).toEqual(back)
  })

  it('AD-AS regime switch carries the long-run rate, so the peg does not drift', () => {
    let s = initialState('adas')
    s = reducer(s, { type: 'set', key: 'M', value: 1200 })
    s = reducer(s, { type: 'regime', regime: 'rate' })
    expect(s.values.i).toBeCloseTo(6, 9)
    expect(adasModel.solve(s).values.drift).toBe(0)
  })
})
