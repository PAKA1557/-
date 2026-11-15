import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { ModelId } from '../engine/types'
import { reducer, type ScenarioState } from '../state/scenario'
import { parse, serialize } from '../state/url'

/** Scenario state initialised from, and mirrored into, the URL query string. */
export function useScenario() {
  const [state, dispatch] = useReducer(reducer, undefined, () => parse(window.location.search))
  // Last state left on each model tab, so a tab that shares nothing with the
  // one being left (e.g. IS-MP-PC ↔ IS-LM) resumes where it was.
  const memory = useRef<Partial<Record<ModelId, ScenarioState>>>({})
  useEffect(() => {
    memory.current[state.model] = state
    const q = serialize(state)
    const url = `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', url)
  }, [state])
  const selectModel = useCallback((model: ModelId) => dispatch({ type: 'model', model, remembered: memory.current[model] }), [])
  return [state, dispatch, selectModel] as const
}

export function shareUrl(): string {
  return window.location.href
}
