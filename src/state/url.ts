/**
 * Scenario <-> URL query string, so a scenario can be shared by link.
 *
 *   ?model=islm&regime=rate&G=150&i=5&b.regime=money&b.G=100
 *
 * Only values that differ from the model defaults are written. Unknown keys
 * are ignored and numbers are clamped to the variable ranges on parse.
 */
import { DEFAULT_MODEL, isModelId } from '../engine/registry'
import type { ModelDefinition, Values } from '../engine/types'
import { clampTo, defaultValues, initialState, requireModel, type ScenarioState, type Snapshot } from './scenario'

const BASE = 'b.'

function writeSnapshot(q: URLSearchParams, model: ModelDefinition, snap: Snapshot, prefix: string) {
  if (snap.regime !== model.defaultRegime) q.set(`${prefix}regime`, snap.regime)
  for (const v of model.variables) {
    const value = snap.values[v.key]
    if (value !== v.default) q.set(prefix + v.key, String(value))
  }
}

export function serialize(state: ScenarioState): string {
  const model = requireModel(state.model)
  const q = new URLSearchParams()
  if (state.model !== DEFAULT_MODEL) q.set('model', state.model)
  writeSnapshot(q, model, state, '')
  writeSnapshot(q, model, state.baseline, BASE)
  return q.toString()
}

function readSnapshot(q: URLSearchParams, model: ModelDefinition, prefix: string): Snapshot {
  const regimeParam = q.get(`${prefix}regime`)
  const regime = model.regimes.some((r) => r.id === regimeParam) ? (regimeParam as string) : model.defaultRegime
  const values: Values = defaultValues(model)
  for (const v of model.variables) {
    const raw = q.get(prefix + v.key)
    if (raw === null || raw.trim() === '') continue
    const n = Number(raw)
    if (Number.isFinite(n)) values[v.key] = clampTo(v, n)
  }
  return { regime, values }
}

export function parse(search: string): ScenarioState {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const modelParam = q.get('model') ?? DEFAULT_MODEL
  const base = initialState(isModelId(modelParam) ? modelParam : DEFAULT_MODEL)
  const model = requireModel(base.model)
  const current = readSnapshot(q, model, '')
  const baseline = readSnapshot(q, model, BASE)
  return { model: model.id, ...current, baseline }
}
