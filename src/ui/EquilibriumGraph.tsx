import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { useId, useState, type PointerEvent } from 'react'
import { fmt } from '../engine'
import type { AxisSpec, Curve, Point, Solution } from '../engine/types'

interface Props {
  axes: { x: AxisSpec; y: AxisSpec }
  xDomain: [number, number]
  yDomain: [number, number]
  current: Solution
  baseline: Solution
  /** True when the baseline differs from the current state (ghosts worth drawing). */
  showGhost: boolean
  onSaveBaseline: () => void
}

const W = 560
const H = 380
const M = { l: 74, r: 64, t: 14, b: 44 }

const curveClass = (id: string) => (id === 'IS' ? 'curve-is' : 'curve-lm')

/** Last point of a curve inside the visible box, for a direct label. */
function labelAnchor(c: Curve, yDomain: [number, number]): Point | null {
  const inside = c.points.filter((p) => p.y >= yDomain[0] && p.y <= yDomain[1])
  return inside.length ? inside[inside.length - 1] : null
}

/** Linear interpolation of a sampled curve at x. */
function curveAt(c: Curve, x: number): number | null {
  const pts = c.points
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1]
    const b = pts[j]
    if (x >= a.x && x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1)
  }
  return null
}

export function EquilibriumGraph({ axes, xDomain, yDomain, current, baseline, showGhost, onSaveBaseline }: Props) {
  const clipId = useId()
  const [hoverX, setHoverX] = useState<number | null>(null)
  const x = scaleLinear().domain(xDomain).range([M.l, W - M.r])
  const y = scaleLinear().domain(yDomain).range([H - M.b, M.t])
  const path = line<Point>()
    .x((p) => x(p.x))
    .y((p) => y(p.y))

  const e = current.equilibrium.point
  const e0 = baseline.equilibrium.point
  const inBox = (p: Point) => p.x >= xDomain[0] && p.x <= xDomain[1] && p.y >= yDomain[0] && p.y <= yDomain[1]
  const moved = Math.hypot(x(e.x) - x(e0.x), y(e.y) - y(e0.y)) > 4
  const zeroLine = yDomain[0] < 0 && yDomain[1] > 0

  const onMove = (ev: PointerEvent<SVGRectElement>) => {
    const svg = ev.currentTarget.ownerSVGElement
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const px = ((ev.clientX - box.left) / box.width) * W
    setHoverX(Math.min(xDomain[1], Math.max(xDomain[0], x.invert(px))))
  }

  return (
    <section className="panel graph" aria-labelledby="graph-title">
      <div className="panel-head">
        <h2 id="graph-title">균형 그래프</h2>
        <button type="button" className="btn small" onClick={onSaveBaseline} disabled={!showGhost}>
          기준점으로 저장
        </button>
      </div>
      <div className="legend" aria-hidden="true">
        <span><i className="swatch curve-is" /> IS</span>
        <span><i className="swatch curve-lm" /> LM</span>
        <span><i className="swatch ghost-swatch" /> 점선: 기준점</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="chart"
        role="img"
        aria-label={`IS-LM 그래프. 균형 산출 ${fmt(e.x, 0)}, 금리 ${fmt(e.y, 2)}%.`}
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
          {x.ticks(6).map((t) => (
            <text key={`x${t}`} x={x(t)} y={H - M.b + 18} textAnchor="middle">
              {fmt(t, 0)}
            </text>
          ))}
          {y.ticks(6).map((t) => (
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
            baseline.curves.map((c) => (
              <path key={`g${c.id}`} d={path(c.points) ?? ''} className={`curve ghost ${curveClass(c.id)}`} />
            ))}
          {current.curves.map((c) => (
            <path key={c.id} d={path(c.points) ?? ''} className={`curve ${curveClass(c.id)}`} />
          ))}

          {/* dropped guide lines */}
          {inBox(e) && (
            <g className="guides">
              <line x1={x(e.x)} x2={x(e.x)} y1={y(e.y)} y2={H - M.b} />
              <line x1={M.l} x2={x(e.x)} y1={y(e.y)} y2={y(e.y)} />
            </g>
          )}

          {showGhost && inBox(e0) && <circle className="eq ghost-eq" cx={x(e0.x)} cy={y(e0.y)} r={5} />}
          {showGhost && moved && inBox(e) && inBox(e0) && (
            <line
              className="shift-arrow"
              x1={x(e0.x)}
              y1={y(e0.y)}
              x2={x(e.x) - ((x(e.x) - x(e0.x)) / Math.hypot(x(e.x) - x(e0.x), y(e.y) - y(e0.y))) * 9}
              y2={y(e.y) - ((y(e.y) - y(e0.y)) / Math.hypot(x(e.x) - x(e0.x), y(e.y) - y(e0.y))) * 9}
              markerEnd={`url(#${clipId}-arrow)`}
            />
          )}
          {inBox(e) && <circle className="eq" cx={x(e.x)} cy={y(e.y)} r={6} />}
          {inBox(e) && (
            <text className="eq-label" x={x(e.x) + 9} y={y(e.y) - 9}>
              E
            </text>
          )}
          {showGhost && moved && inBox(e0) && (
            <text className="eq-label ghost-label" x={x(e0.x) - 9} y={y(e0.y) + 16} textAnchor="end">
              E₀
            </text>
          )}

          {hoverX !== null && (
            <g className="crosshair">
              <line x1={x(hoverX)} x2={x(hoverX)} y1={M.t} y2={H - M.b} />
              {current.curves.map((c) => {
                const v = curveAt(c, hoverX)
                return v === null || v < yDomain[0] || v > yDomain[1] ? null : (
                  <circle key={c.id} cx={x(hoverX)} cy={y(v)} r={4} className={`hover-dot ${curveClass(c.id)}`} />
                )
              })}
            </g>
          )}
        </g>

        {/* direct curve labels, outside the clip so they never get cut */}
        {current.curves.map((c) => {
          const a = labelAnchor(c, yDomain)
          return a ? (
            <text key={`l${c.id}`} className="curve-label" x={x(a.x) + 6} y={y(a.y) + 4}>
              {c.label}
            </text>
          ) : null
        })}

        {/* value labels on the axes */}
        {inBox(e) && (
          <g className="value-tag">
            <rect x={x(e.x) - 32} y={H - M.b + 3} width={64} height={20} rx={4} />
            <text x={x(e.x)} y={H - M.b + 17} textAnchor="middle">
              {fmt(e.x, 0)}
            </text>
            <rect x={M.l - 54} y={y(e.y) - 10} width={52} height={20} rx={4} />
            <text x={M.l - 28} y={y(e.y) + 4} textAnchor="middle">
              {fmt(e.y, 2)}
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
          Y = {fmt(hoverX, 0)}:{' '}
          {current.curves
            .map((c) => {
              const v = curveAt(c, hoverX)
              return v === null ? null : `${c.id}의 i = ${fmt(v, 2)}%`
            })
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {!inBox(e) && <p className="warn">균형점이 그래프 범위를 벗어났습니다.</p>}
    </section>
  )
}
