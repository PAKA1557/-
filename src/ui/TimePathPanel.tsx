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

const DW = 260
const DH = 104
const DM = { l: 8, r: 8, t: 10, b: 16 }

/** Impulse response over t = 0…T, with an optional reference line and a highlighted period. */
function DynamicChart({ path, period }: { path: TimePath; period: number }) {
  const vals = path.values
  const n = vals.length - 1
  const t = Math.min(Math.max(0, period), n)
  const finite = vals.filter(Number.isFinite)
  const ref = path.reference && Number.isFinite(path.reference.value) ? path.reference : undefined
  const all = ref ? [...finite, ref.value] : finite
  const lo = Math.min(...all)
  const hi = Math.max(...all)
  const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.005, 10 ** -path.digits)
  const x = scaleLinear().domain([0, n]).range([DM.l, DW - DM.r])
  const y = scaleLinear().domain([lo - pad, hi + pad]).range([DH - DM.b, DM.t])
  const d = line<number>()
    .defined((v) => Number.isFinite(v))
    .x((_, j) => x(j))
    .y((v) => y(v))(vals)
  const v = vals[t]
  const ticks = [0, 10, 20, 30, 40].filter((k) => k <= n)
  const unit = path.unit ?? ''
  return (
    <figure className="path">
      <figcaption>
        <span>{path.label}</span>
        <span className="path-now" data-testid={`path-${path.key}`}>
          {t}기: {Number.isFinite(v) ? `${fmt(v, path.digits)}${unit}` : '—'}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${DW} ${DH}`}
        role="img"
        aria-label={`${path.label}의 시간 경로: 0기 ${fmt(vals[0], path.digits)}${unit}, 1기 ${fmt(vals[1], path.digits)}${unit}, ${n}기 ${fmt(vals[n], path.digits)}${unit}`}
      >
        {ref && (
          <g className="path-ref">
            <line x1={DM.l} x2={DW - DM.r} y1={y(ref.value)} y2={y(ref.value)} />
            <text x={DW - DM.r} y={y(ref.value) - 3} textAnchor="end">
              {ref.label} {fmt(ref.value, path.digits)}
            </text>
          </g>
        )}
        <line className="path-divider" x1={x(t)} x2={x(t)} y1={DM.t - 4} y2={DH - DM.b} />
        <path d={d ?? ''} className="path-line" />
        {Number.isFinite(v) && <circle className="path-dot" cx={x(t)} cy={y(v)} r={3.5} />}
        {ticks.map((k) => (
          <text key={k} className="path-period" x={x(k)} y={DH - 3} textAnchor={k === 0 ? 'start' : k === n ? 'end' : 'middle'}>
            {k}
          </text>
        ))}
      </svg>
    </figure>
  )
}

interface PanelProps {
  paths: TimePath[]
  note?: string
  period: number
}

export function TimePathPanel({ paths, note, period }: PanelProps) {
  return (
    <section className="panel timepaths" aria-labelledby="paths-title">
      <h2 id="paths-title">시간 경로</h2>
      {note && <p className="hint">{note}</p>}
      {paths.map((p) => (p.kind === 'dynamic' ? <DynamicChart key={p.key} path={p} period={period} /> : <StepChart key={p.key} path={p} />))}
    </section>
  )
}
