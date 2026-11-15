import type { ReactNode } from 'react'
import type { ModelDefinition, Solution, Values, VariableSpec } from '../engine/types'
import { ChoiceControl, LockedVariable, Slider } from './Slider'

interface Props {
  model: ModelDefinition
  regime: string
  values: Values
  solution: Solution
  onSet: (key: string, value: number) => void
  onRegime: (regime: string) => void
}

export function ControlPanel({ model, regime, values, solution, onSet, onRegime }: Props) {
  const locks = new Map(model.lockedVariables(regime).map((l) => [l.key, l]))
  const flagged = new Set(solution.warnings.map((w) => w.key))
  const visible = (v: VariableSpec) => !v.visibleWhen || values[v.visibleWhen.key] === v.visibleWhen.equals
  const control = (v: VariableSpec) => {
    const lock = locks.get(v.key)
    if (lock) return <LockedVariable key={v.key} spec={v} value={solution.values[lock.resultKey]} reason={lock.reason} flagged={flagged.has(v.key)} />
    if (v.choices) return <ChoiceControl key={v.key} spec={v} value={values[v.key]} onChange={(x) => onSet(v.key, x)} />
    return <Slider key={v.key} spec={v} value={values[v.key]} onChange={(x) => onSet(v.key, x)} />
  }
  const render = (group: 'policy' | 'param') => {
    const out: ReactNode[] = []
    let section: string | undefined
    for (const v of model.variables.filter((u) => u.group === group && visible(u))) {
      if (v.section && v.section !== section) out.push(<h3 key={`s-${v.section}`} className="control-section">{v.section}</h3>)
      section = v.section
      out.push(control(v))
    }
    return out
  }
  const current = model.regimes.find((r) => r.id === regime)

  return (
    <section className="panel controls" aria-labelledby="controls-title">
      <h2 id="controls-title">정책 변수</h2>
      <fieldset className="regime">
        <legend>{model.regimeLabel}{model.regimes.length === 1 && current ? `: ${current.label}` : ''}</legend>
        {model.regimes.length > 1 && (
          <div className="segmented">
            {model.regimes.map((r) => (
              <label key={r.id} className={r.id === regime ? 'seg active' : 'seg'}>
                <input type="radio" name="regime" value={r.id} checked={r.id === regime} onChange={() => onRegime(r.id)} />
                {r.label}
              </label>
            ))}
          </div>
        )}
        {current && <p className="hint">{current.description}</p>}
      </fieldset>
      {render('policy')}
      <details className="params">
        <summary>모형 파라미터</summary>
        {render('param')}
      </details>
    </section>
  )
}
