/**
 * Scenario state: selected model, regime, policy variables / parameters,
 * and the baseline snapshot shown as dashed "ghost" curves.
 */
import { DEFAULT_MODEL, getModel } from '../engine/registry'
import type { ModelDefinition, ModelId, Values, VariableSpec } from '../engine/types'

export interface Snapshot {
  regime: string
  values: Values
}

export interface ScenarioState extends Snapshot {
  model: ModelId
  baseline: Snapshot
}

export type Action =
  | { type: 'set'; key: string; value: number }
  | { type: 'regime'; regime: string }
  | { type: 'saveBaseline' }
  | { type: 'reset' }
  | { type: 'model'; model: ModelId }
  | { type: 'load'; state: ScenarioState }

export function requireModel(id: ModelId): ModelDefinition {
  const m = getModel(id) ?? getModel(DEFAULT_MODEL)
  if (!m) throw new Error('no default model')
  return m
}

export function defaultValues(model: ModelDefinition): Values {
  return Object.fromEntries(model.variables.map((v) => [v.key, v.default]))
}

export function clampTo(spec: VariableSpec, value: number): number {
  // `+ 0` normalizes −0 so values survive a text round-trip unchanged.
  return Math.min(spec.max, Math.max(spec.min, value)) + 0
}

export function initialState(modelId: ModelId = DEFAULT_MODEL): ScenarioState {
  const model = requireModel(modelId)
  const values = defaultValues(model)
  return {
    model: model.id,
    regime: model.defaultRegime,
    values,
    baseline: { regime: model.defaultRegime, values: { ...values } },
  }
}

/**
 * Switching regime: a variable that was an outcome becomes a control. It
 * starts at its equilibrium value so the switch alone does not move the
 * equilibrium (as long as that value is within the slider range).
 */
function switchRegime(state: ScenarioState, regime: string): ScenarioState {
  const model = requireModel(state.model)
  if (!model.regimes.some((r) => r.id === regime) || regime === state.regime) return state
  const solution = model.solve({ regime: state.regime, values: state.values })
  const nowLocked = new Set(model.lockedVariables(regime).map((l) => l.key))
  const values = { ...state.values }
  for (const lock of model.lockedVariables(state.regime)) {
    const spec = model.variables.find((v) => v.key === lock.key)
    const result = solution.values[lock.resultKey]
    if (spec && !nowLocked.has(lock.key) && Number.isFinite(result)) {
      values[lock.key] = clampTo(spec, result)
    }
  }
  return { ...state, regime, values }
}

export function reducer(state: ScenarioState, action: Action): ScenarioState {
  switch (action.type) {
    case 'set': {
      const spec = requireModel(state.model).variables.find((v) => v.key === action.key)
      if (!spec || !Number.isFinite(action.value)) return state
      return { ...state, values: { ...state.values, [action.key]: clampTo(spec, action.value) } }
    }
    case 'regime':
      return switchRegime(state, action.regime)
    case 'saveBaseline':
      return { ...state, baseline: { regime: state.regime, values: { ...state.values } } }
    case 'reset':
      return initialState(state.model)
    case 'model':
      return getModel(action.model) && action.model !== state.model ? initialState(action.model) : state
    case 'load':
      return action.state
  }
}
