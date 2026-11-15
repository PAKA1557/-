import { useEffect, useReducer } from 'react'
import { reducer } from '../state/scenario'
import { parse, serialize } from '../state/url'

/** Scenario state initialised from, and mirrored into, the URL query string. */
export function useScenario() {
  const [state, dispatch] = useReducer(reducer, undefined, () => parse(window.location.search))
  useEffect(() => {
    const q = serialize(state)
    const url = `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', url)
  }, [state])
  return [state, dispatch] as const
}

export function shareUrl(): string {
  return window.location.href
}
