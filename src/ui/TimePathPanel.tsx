import { scaleLinear } from 'd3-scale'
import { curveStepAfter, line } from 'd3-shape'
import { fmt } from '../engine'
import type { TimePath } from '../engine/types'

const W = 260
const H = 96
const M = { l: 8, r: 8, t: 18, b: 18 }

function StepChart({ path }: { path: TimePath }) {
  const vals = path.values
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max((hi - lo) * 0.35, Math.abs(hi) * 0.02, 0.5)
  const x = scaleLinear().domain([0, vals.length]).range([M.l, W - M.r])
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([H - M.b, M.t])
  const pts: [number, number][] = [...vals.map((v, t) => [t, v] as [number, number]), [vals.length, vals[vals.length - 1]]]
  const d = line<[number, number]>()
    .x((p) => x(p[0]))
    .y((p) => y(p[1]))
    .curve(curveStepAfter)(pts)
  const first = vals[0]
  const last = vals[vals.length - 1]
  const delta = last - first
  const same = Math.abs(delta) < 0.5 * 10 ** -path.digits
  return (
    <figure className="path">
      <figcaption>
        <span>{path.label}</span>
        <span className={same ? 'delta' : delta > 0 ? 'delta up' : 'delta down'}>
          {same ? '변화 없음' : `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta), path.digits)}${path.unit ?? ''}`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${path.label}: ${path.periods.map((p, t) => `${p} ${fmt(vals[t], path.digits)}`).join(', ')}`}>
        <line className="path-base" x1={M.l} x2={W - M.r} y1={y(first)} y2={y(first)} />
        <line className="path-divider" x1={x(1)} x2={x(1)} y1={M.t - 6} y2={H - M.b} />
        <path d={d ?? ''} className="path-line" />
        {vals.map((v, t) => (
          <text key={t} className="path-value" x={x(t + 0.5)} y={y(v) - 6} textAnchor="middle">
            {fmt(v, path.digits)}
          </text>
        ))}
        {path.periods.map((p, t) => (
          <text key={p} className="path-period" x={x(t + 0.5)} y={H - 4} textAnchor="middle">
            {p}
          </text>
        ))}
      </svg>
    </figure>
  )
}

export function TimePathPanel({ paths }: { paths: TimePath[] }) {
  return (
    <section className="panel timepaths" aria-labelledby="paths-title">
      <h2 id="paths-title">시간 경로</h2>
      <p className="hint">
        IS-LM은 정태 모형이라 시간에 따른 조정 과정은 없습니다. 기준점에서 현재 균형으로의 수준 변화만 계단으로 보여 줍니다.
      </p>
      {paths.map((p) => (
        <StepChart key={p.key} path={p} />
      ))}
    </section>
  )
}
