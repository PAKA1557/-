import type { ModelDefinition, Solution, Values } from '../engine/types'
import { LockedVariable, Slider } from './Slider'

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
  const render = (group: 'policy' | 'param') =>
    model.variables
      .filter((v) => v.group === group)
      .map((v) => {
        const lock = locks.get(v.key)
        return lock ? (
          <LockedVariable key={v.key} spec={v} value={solution.values[lock.resultKey]} reason={lock.reason} flagged={flagged.has(v.key)} />
        ) : (
          <Slider key={v.key} spec={v} value={values[v.key]} onChange={(x) => onSet(v.key, x)} />
        )
      })
  const current = model.regimes.find((r) => r.id === regime)

  return (
    <section className="panel controls" aria-labelledby="controls-title">
      <h2 id="controls-title">정책 변수</h2>
      <fieldset className="regime">
        <legend>{model.regimeLabel}</legend>
        <div className="segmented">
          {model.regimes.map((r) => (
            <label key={r.id} className={r.id === regime ? 'seg active' : 'seg'}>
              <input type="radio" name="regime" value={r.id} checked={r.id === regime} onChange={() => onRegime(r.id)} />
              {r.label}
            </label>
          ))}
        </div>
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
