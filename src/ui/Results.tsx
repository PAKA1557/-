import { fmt } from '../engine'
import type { ModelDefinition, Solution } from '../engine/types'

interface Props {
  model: ModelDefinition
  regime: string
  current: Solution
  baseline: Solution
}

export function Results({ model, regime, current, baseline }: Props) {
  const locked = new Set(model.lockedVariables(regime).map((l) => l.resultKey))
  const flagged = new Set(current.warnings.map((w) => w.key))
  return (
    <div className="results">
      <dl className="outputs">
        {model.outputs.map((o) => {
          const v = current.values[o.key]
          const d = v - baseline.values[o.key]
          const showDelta = Math.abs(d) >= 0.5 * 10 ** -o.digits
          return (
            <div key={o.key} className={`out${locked.has(o.key) ? ' out-locked' : ''}${flagged.has(o.key) ? ' out-flag' : ''}`}>
              <dt>
                {o.label} <span className="sym">{o.symbol}</span>
              </dt>
              <dd data-testid={`out-${o.key}`}>
                {fmt(v, o.digits)}
                {o.unit}
              </dd>
              <dd className={`delta${showDelta ? (d > 0 ? ' up' : ' down') : ''}`}>
                {showDelta ? `${d > 0 ? '+' : '−'}${fmt(Math.abs(d), o.digits)}` : '±0'}
              </dd>
            </div>
          )
        })}
      </dl>
      {current.warnings.length > 0 && (
        <ul className="warnings" role="status">
          {current.warnings.map((w) => (
            <li key={w.message}>
              <span className="warn-badge">주의</span> {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
