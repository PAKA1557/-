import { fmt } from '../engine'
import type { ModelDefinition, Solution, StabilityReadout } from '../engine/types'
import { Tex } from './Tex'

const STATUS_LABEL: Record<StabilityReadout['status'], string> = { stable: '안정', unit: '수렴하지 않음', unstable: '불안정' }

function Stability({ s, labels }: { s: StabilityReadout; labels: Record<StabilityReadout['status'], string> }) {
  return (
    <div className={`stability ${s.status}`} data-testid="stability">
      <div className="stability-head">
        <span>{s.label}</span>
        <strong data-testid="stability-value">{s.value}</strong>
        <span className="stability-badge" data-testid="stability-status">
          {labels[s.status]}
        </span>
      </div>
      {s.latex && <Tex latex={s.latex} display />}
      <p>{s.text}</p>
    </div>
  )
}

interface Props {
  model: ModelDefinition
  regime: string
  current: Solution
  baseline: Solution
}

export function Results({ model, regime, current, baseline }: Props) {
  const locked = new Set(model.lockedVariables(regime).map((l) => l.resultKey))
  const flagged = new Set(current.warnings.map((w) => w.key))
  const groups = current.trajectory ? [
    { title: '1기 · 충격 직후', outputs: model.outputs.filter((o) => !o.key.endsWith('LR')) },
    { title: '장기 균형', outputs: model.outputs.filter((o) => o.key.endsWith('LR')) },
  ] : [{ title: '균형값', outputs: model.outputs }]
  const statusLabels = current.stability?.label === '결정성 조건'
    ? { stable: '결정적', unit: '결정성 경계', unstable: '비결정적' } : STATUS_LABEL
  return (
    <div className="results">
      {groups.filter((g) => g.outputs.length).map((g) => <section className="result-group" key={g.title} aria-label={g.title}>
      <h3>{g.title}</h3>
      <dl className="outputs">
        {g.outputs.map((o) => {
          const v = current.values[o.key]
          const d = v - baseline.values[o.key]
          const known = Number.isFinite(d)
          const showDelta = known && Math.abs(d) >= 0.5 * 10 ** -o.digits
          return (
            <div key={o.key} className={`out${locked.has(o.key) ? ' out-locked' : ''}${flagged.has(o.key) ? ' out-flag' : ''}`}>
              <dt>
                {o.label} <span className="sym">{o.symbol}</span>
              </dt>
              <dd data-testid={`out-${o.key}`}>
                {fmt(v, o.digits)}
                {Number.isFinite(v) ? o.unit : ''}
              </dd>
              <dd className={`delta${showDelta ? (d > 0 ? ' up' : ' down') : ''}`}>
                {showDelta ? `${d > 0 ? '+' : '−'}${fmt(Math.abs(d), o.digits)}` : known ? '±0' : '—'}
              </dd>
            </div>
          )
        })}
      </dl>
      </section>)}
      {current.stability && <Stability s={current.stability} labels={statusLabels} />}
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
