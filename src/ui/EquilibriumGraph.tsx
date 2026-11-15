import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useId, useState, type PointerEvent, type ReactNode } from 'react'
import { fmt } from '../engine'
import type { AxisSpec, Curve, Marker, Point, Solution } from '../engine/types'

interface Props {
  title: string
  axes: { x: AxisSpec; y: AxisSpec }
  xDomain: [number, number]
  yDomain: [number, number]
  current: Solution
  baseline: Solution
  /** True when the baseline differs from the current state (ghosts worth drawing). */
  showGhost: boolean
  onSaveBaseline: () => void
  /** Selected period of a dynamic model's trajectory. */
  period?: number
  /** Extra controls under the chart (e.g. the period scrubber). */
  footer?: ReactNode
}

const W = 560
const H = 380
const M = { l: 74, r: 64, t: 14, b: 44 }

const TONE_CLASS = { primary: 'curve-is', secondary: 'curve-lm', reference: 'curve-ref' } as const

const curveClass = (c: Curve, idx: number) => TONE_CLASS[c.tone ?? (idx === 0 ? 'primary' : 'secondary')]

/** Last point of a curve inside the visible box, for a direct label. */
function labelAnchor(c: Curve, xDomain: [number, number], yDomain: [number, number]): Point | null {
  const inside = c.points.filter((p) => p.y >= yDomain[0] && p.y <= yDomain[1] && p.x >= xDomain[0] && p.x <= xDomain[1])
  return inside.length ? inside[inside.length - 1] : null
}

/** Linear interpolation of a sampled curve at x (null for vertical curves). */
function curveAt(c: Curve, x: number): number | null {
  const pts = c.points
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1]
    const b = pts[j]
    if (a.x === b.x) continue
    if (x >= a.x && x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x)
  }
  return null
}

/** Label offsets so E₀ / E₁ / E* do not collide (E₀ and E* share the LRAS). */
const MARKER_OFFSET: Record<Marker['kind'], [number, number]> = {
  baseline: [-1, 1], short: [1, -1], long: [-1, -1],
}

type LabelBox = { left: number; top: number; width: number; height: number }
const overlap = (a: LabelBox, b: LabelBox) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Segment/rectangle clipping, used to keep labels clear of plotted curves. */
function crosses(a: Point, b: Point, box: LabelBox): boolean {
  let lo = 0
  let hi = 1
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, box.left, box.left + box.width],
    [a.y, b.y - a.y, box.top, box.top + box.height],
  ]) {
    if (delta === 0) { if (start < min || start > max) return false; continue }
    const t1 = (min - start) / delta
    const t2 = (max - start) / delta
    lo = Math.max(lo, Math.min(t1, t2))
    hi = Math.min(hi, Math.max(t1, t2))
  }
  return lo <= hi
}

export function EquilibriumGraph({ title, axes, xDomain, yDomain, current, baseline, showGhost, onSaveBaseline, period, footer }: Props) {
  const clipId = useId()
  const [hoverX, setHoverX] = useState<number | null>(null)
  const x = scaleLinear().domain(xDomain).range([M.l, W - M.r])
  const y = scaleLinear().domain(yDomain).range([H - M.b, M.t])
  const path = line<Point>()
    .defined((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .x((p) => x(p.x))
    .y((p) => y(p.y))
  const yDigits = axes.y.digits ?? 2
  const xDigits = axes.x.digits ?? 0
  const yUnit = axes.y.unit ?? ''

  const traj = current.trajectory
  const tSel = traj && period !== undefined ? Math.min(Math.max(0, Math.round(period)), traj.points.length - 1) : null
  const selPoint = traj && tSel !== null ? traj.points[tSel] : null
  const follow = Boolean(traj?.curvesFollowPeriod)
  // SRAS (or similar) of the selected period, unless it is already the solid current curve.
  const selCurves = traj && !follow && tSel !== null && tSel !== 1 ? traj.curves[tSel] ?? [] : []
  // Models whose curves all move each period: the selected period's curves replace the solid ones.
  const periodCurves = traj && follow && tSel !== null ? traj.curves[tSel] ?? [] : []
  const shown = current.curves.map((c) => periodCurves.find((d) => d.id === c.id) ?? c)

  const e = current.equilibrium.point
  const e0 = baseline.equilibrium.point
  const tagPoint = selPoint ?? e
  const inBox = (p: Point) => p.x >= xDomain[0] && p.x <= xDomain[1] && p.y >= yDomain[0] && p.y <= yDomain[1]
  const moved = Math.hypot(x(e.x) - x(e0.x), y(e.y) - y(e0.y)) > 4
  const zeroLine = yDomain[0] < 0 && yDomain[1] > 0
  const xTag = fmt(tagPoint.x, xDigits)
  const xTagWidth = Math.max(64, xTag.length * 10 + 16)
  const xTagCenter = clamp(x(tagPoint.x), M.l + xTagWidth / 2, W - M.r - xTagWidth / 2)
  const yTag = fmt(tagPoint.y, yDigits)

  const onMove = (ev: PointerEvent<SVGRectElement>) => {
    const svg = ev.currentTarget.ownerSVGElement
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const px = ((ev.clientX - box.left) / box.width) * W
    setHoverX(Math.min(xDomain[1], Math.max(xDomain[0], x.invert(px))))
  }

  // Arrowed segments of the adjustment path (skip segments too short to show a head).
  const segs: [Point, Point][] = []
  if (traj) {
    for (let t = 1; t < traj.points.length; t++) {
      const a = traj.points[t - 1]
      const b = traj.points[t]
      if (Math.hypot(x(b.x) - x(a.x), y(b.y) - y(a.y)) > 14) segs.push([a, b])
    }
  }
  const shorten = (a: Point, b: Point, px: number) => {
    const dx = x(b.x) - x(a.x)
    const dy = y(b.y) - y(a.y)
    const len = Math.hypot(dx, dy) || 1
    return { x2: x(b.x) - (dx / len) * px, y2: y(b.y) - (dy / len) * px }
  }

  const markers = current.markers
  const ariaPoint = markers?.find((m) => m.kind === 'short')?.point ?? e
  const labelMarkers: Marker[] = markers ?? [
    { point: e, label: 'E', kind: 'short' },
    ...(showGhost && moved ? [{ point: e0, label: 'E₀', kind: 'baseline' as const }] : []),
  ]
  const occupied: LabelBox[] = []
  const segments = shown.flatMap((c) => c.points.slice(1).map((b, j) => [
    { x: x(c.points[j].x), y: y(c.points[j].y) }, { x: x(b.x), y: y(b.y) },
  ] as const))
  const markerLabels = labelMarkers.filter((m) => inBox(m.point)).map((m) => {
    const width = Math.max(28, m.label.length * 12)
    const [sx, sy] = MARKER_OFFSET[m.kind]
    const candidates = [14, 28, 44].flatMap((gap) => [[sx, sy], [-sx, sy], [sx, -sy], [-sx, -sy]].map(([dx, dy]) => ({
      left: clamp(x(m.point.x) + (dx > 0 ? gap : -gap - width), M.l + 8, W - M.r - width - 8),
      top: clamp(y(m.point.y) + (dy > 0 ? gap : -gap - 20), M.t + 6, H - M.b - 26),
      width, height: 20,
    })))
    const score = (box: LabelBox) => occupied.filter((b) => overlap(box, b)).length * 1000
      + labelMarkers.filter((q) => overlap(box, { left: x(q.point.x) - 9, top: y(q.point.y) - 9, width: 18, height: 18 })).length * 200
      + segments.filter(([a, b]) => crosses(a, b, box)).length * 100
    const box = candidates.reduce((best, b) => score(b) < score(best) ? b : best)
    occupied.push(box)
    return { m, box }
  })

  return (
    <section className="panel graph" aria-labelledby="graph-title">
      <div className="panel-head">
        <h2 id="graph-title">균형 그래프</h2>
        <button type="button" className="btn small" onClick={onSaveBaseline} disabled={!showGhost}>
          기준점으로 저장
        </button>
      </div>
      <div className="legend" aria-hidden="true">
        {current.curves.map((c, idx) => (
          <span key={c.id}>
            <i className={`swatch ${curveClass(c, idx)}`} /> {c.label}
          </span>
        ))}
        <span>
          <i className="swatch ghost-swatch" /> 점선: 기준점
        </span>
        {traj && (
          <span>
            <i className="dot-swatch" /> 조정 경로(0→{traj.points.length - 1}기)
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label={`${title} 그래프. ${markers ? '단기 ' : ''}균형 ${axes.x.key} = ${fmt(ariaPoint.x, xDigits)}, ${axes.y.key} = ${fmt(ariaPoint.y, yDigits)}${yUnit}.`}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} />
          </clipPath>
          <marker id={`${clipId}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
          </marker>
        </defs>

        {/* grid + axes */}
        <g className="grid">
          {y.ticks(6).map((t) => (
            <line key={`gy${t}`} x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        {zeroLine && <line className="zero" x1={M.l} x2={W - M.r} y1={y(0)} y2={y(0)} />}
        <g className="axis">
          <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
          <line x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} />
          {x.ticks(6).filter((t) => !inBox(tagPoint) || Math.abs(x(t) - xTagCenter) > xTagWidth / 2 + fmt(t, Number.isInteger(t) ? 0 : 1).length * 5 + 6).map((t) => (
            <text key={`x${t}`} x={x(t)} y={H - M.b + 18} textAnchor="middle">
              {fmt(t, Number.isInteger(t) ? 0 : 1)}
            </text>
          ))}
          {y.ticks(6).filter((t) => y(t) < H - M.b - 12 && (!inBox(tagPoint) || Math.abs(y(t) - y(tagPoint.y)) > 23)).map((t) => (
            <text key={`y${t}`} x={M.l - 8} y={y(t) + 4} textAnchor="end">
              {fmt(t, Number.isInteger(t) ? 0 : 1)}
            </text>
          ))}
          <text className="axis-title" x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle">
            {axes.x.label}
          </text>
          <text className="axis-title" transform={`translate(10 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle">
            {axes.y.label}
            {axes.y.unit ? ` (${axes.y.unit})` : ''}
          </text>
        </g>

        <g clipPath={`url(#${clipId})`}>
          {showGhost &&
            baseline.curves.map((c, idx) => (
              <path key={`g${c.id}`} d={path(c.points) ?? ''} className={`curve ghost ${curveClass(c, idx)}`} />
            ))}
          {shown.map((c, idx) => (
            <path key={c.id} d={path(c.points) ?? ''} className={`curve ${curveClass(c, idx)}`} data-testid={`curve-${c.id}`} />
          ))}
          {selCurves.map((c) => (
            <path key={`sel${c.id}`} d={path(c.points) ?? ''} className="curve curve-sel" />
          ))}

          {/* dropped guide lines */}
          {inBox(tagPoint) && (
            <g className="guides">
              <line x1={x(tagPoint.x)} x2={x(tagPoint.x)} y1={y(tagPoint.y)} y2={H - M.b} />
              <line x1={M.l} x2={x(tagPoint.x)} y1={y(tagPoint.y)} y2={y(tagPoint.y)} />
            </g>
          )}

          {traj && (
            <g className="traj" data-testid="trajectory">
              {segs.map(([a, b], j) => (
                <line key={j} x1={x(a.x)} y1={y(a.y)} {...shorten(a, b, 5)} markerEnd={`url(#${clipId}-arrow)`} />
              ))}
              <path d={path(traj.points) ?? ''} className="traj-line" />
              {traj.points.map((p, t) => Number.isFinite(p.x) && Number.isFinite(p.y) && (
                <circle key={t} className="traj-dot" cx={x(p.x)} cy={y(p.y)} r={2.2} />
              ))}
            </g>
          )}

          {markers ? (
            markers.filter((m) => inBox(m.point)).map((m) => (
              <circle key={m.label} className={m.kind === 'baseline' && markers.length > 1 ? 'eq ghost-eq' : 'eq'} cx={x(m.point.x)} cy={y(m.point.y)} r={m.kind === 'short' ? 6 : 5} />
            ))
          ) : (
            <>
              {showGhost && inBox(e0) && <circle className="eq ghost-eq" cx={x(e0.x)} cy={y(e0.y)} r={5} />}
              {showGhost && moved && inBox(e) && inBox(e0) && (
                <line className="shift-arrow" x1={x(e0.x)} y1={y(e0.y)} {...shorten(e0, e, 9)} markerEnd={`url(#${clipId}-arrow)`} />
              )}
              {inBox(e) && <circle className="eq" cx={x(e.x)} cy={y(e.y)} r={6} />}
            </>
          )}
          {selPoint && inBox(selPoint) && <circle className="sel-point" cx={x(selPoint.x)} cy={y(selPoint.y)} r={8} />}

          {hoverX !== null && (
            <g className="crosshair">
              <line x1={x(hoverX)} x2={x(hoverX)} y1={M.t} y2={H - M.b} />
              {shown.map((c, idx) => {
                const v = curveAt(c, hoverX)
                return v === null || v < yDomain[0] || v > yDomain[1] ? null : (
                  <circle key={c.id} cx={x(hoverX)} cy={y(v)} r={4} className={`hover-dot ${curveClass(c, idx)}`} />
                )
              })}
            </g>
          )}
        </g>

        {/* point labels */}
        {markerLabels.map(({ m, box }) => (
          <g key={`t${m.label}`}>
            <line className="label-leader" x1={x(m.point.x)} y1={y(m.point.y)} x2={box.left + box.width / 2} y2={box.top + 10} />
            <text className={`eq-label${m.kind === 'baseline' && labelMarkers.length > 1 ? ' ghost-label' : ''}`} x={box.left + box.width / 2} y={box.top + 16} textAnchor="middle">{m.label}</text>
          </g>
        ))}

        {/* direct curve labels, outside the clip so they never get cut */}
        {[...shown, ...selCurves].map((c) => {
          const a = labelAnchor(c, xDomain, yDomain)
          const vertical = c.points.length > 1 && c.points[0].x === c.points[c.points.length - 1].x
          return a ? (
            <text key={`l${c.id}`} className={`curve-label${selCurves.includes(c) ? ' sel-label' : ''}`} textAnchor="end" x={clamp(x(a.x) - 8, M.l + Math.max(50, c.label.length * 18), W - M.r - 10)} y={clamp(y(a.y) + (vertical ? 20 : -12), M.t + 22, H - M.b - 16)}>
              {c.label}
            </text>
          ) : null
        })}

        {/* value labels on the axes */}
        {inBox(tagPoint) && (
          <g className="value-tag">
            <rect x={xTagCenter - xTagWidth / 2} y={H - M.b + 2} width={xTagWidth} height={24} rx={4} />
            <text x={xTagCenter} y={H - M.b + 19} textAnchor="middle">
              {xTag}
            </text>
            <rect x={M.l - 54} y={y(tagPoint.y) - 10} width={52} height={20} rx={4} />
            <text x={M.l - 28} y={y(tagPoint.y) + 4} textAnchor="middle">
              {yTag}
            </text>
          </g>
        )}

        <rect
          className="hit"
          x={M.l}
          y={M.t}
          width={W - M.l - M.r}
          height={H - M.t - M.b}
          onPointerMove={onMove}
          onPointerLeave={() => setHoverX(null)}
        />
      </svg>
      {hoverX !== null && (
        <p className="tooltip-line" aria-live="polite">
          {axes.x.key} = {fmt(hoverX, xDigits)}:{' '}
          {shown
            .map((c) => {
              const v = curveAt(c, hoverX)
              return v === null ? null : `${c.label}의 ${axes.y.key} = ${fmt(v, yDigits)}${yUnit}`
            })
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {!inBox(e) && <p className="warn">{Number.isFinite(e.x) && Number.isFinite(e.y) ? '균형점이 그래프 범위를 벗어났습니다.' : '현재 조건에서는 유일한 균형 경로를 표시할 수 없습니다.'}</p>}
      {traj && traj.points.some((p) => !inBox(p)) && inBox(e) && (
        <p className="hint">조정 경로의 일부가 그래프 범위를 벗어납니다. 아래 시간 경로에서 전체 기간을 볼 수 있습니다.</p>
      )}
      {footer}
    </section>
  )
}
