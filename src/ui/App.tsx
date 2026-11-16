import { useEffect, useMemo, useState } from 'react'
import { fitDomain } from '../engine'
import type { Point, Solution } from '../engine/types'
import { requireModel } from '../state/scenario'
import { ControlPanel } from './ControlPanel'
import { EquilibriumGraph } from './EquilibriumGraph'
import { ExplanationPanel } from './ExplanationPanel'
import { ModelTabs } from './ModelTabs'
import { PeriodScrubber } from './PeriodScrubber'
import { Results } from './Results'
import { TimePathPanel } from './TimePathPanel'
import { useScenario } from './useScenario'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** Points the graph ranges must show: the equilibrium, labelled markers and the fitted part of the trajectory. */
function graphPoints(s: Solution): Point[] {
  const traj = s.trajectory
  return [
    s.equilibrium.point,
    ...(s.markers ?? []).map((m) => m.point),
    ...(traj ? traj.points.slice(0, traj.fitUntil + 1) : []),
  ]
}

export default function App() {
  const [state, dispatch, selectModel] = useScenario()
  const [toast, setToast] = useState<string | null>(null)
  const model = requireModel(state.model)

  const view = useMemo(() => {
    const base0 = model.solve(state.baseline)
    const cur0 = model.solve(state, { baseline: base0 })
    const pts = [...graphPoints(cur0), ...graphPoints(base0)]
    const xDomain = fitDomain(model.axes.x.defaultDomain, pts.map((p) => p.x))
    const yDomain = fitDomain(model.axes.y.defaultDomain, pts.map((p) => p.y))
    const baseline = model.solve(state.baseline, { xDomain, yDomain })
    const current = model.solve(state, { xDomain, yDomain, baseline })
    const sentences = model.explain({ input: state.baseline, solution: baseline }, { input: state, solution: current })
    return { xDomain, yDomain, baseline, current, sentences }
  }, [model, state])

  // Period scrubber for dynamic models.
  const maxPeriod = view.current.trajectory ? view.current.trajectory.points.length - 1 : 0
  const [periodRaw, setPeriod] = useState(1)
  const [playing, setPlaying] = useState(false)
  const period = Math.min(periodRaw, maxPeriod)
  const running = playing && period < maxPeriod
  useEffect(() => {
    if (!running) return
    const id = window.setTimeout(() => {
      setPeriod(period + 1)
      if (period + 1 >= maxPeriod) setPlaying(false)
    }, 250)
    return () => window.clearTimeout(id)
  }, [running, period, maxPeriod])
  const togglePlay = () => {
    if (!running && period >= maxPeriod) setPeriod(0)
    setPlaying(!running)
  }

  const ghost = state.baseline.regime !== state.regime || model.variables.some((v) => state.baseline.values[v.key] !== state.values[v.key])

  const share = async () => {
    const ok = await copyText(window.location.href)
    setToast(ok ? '현재 시나리오 링크를 복사했습니다.' : '복사하지 못했습니다. 주소창의 링크를 직접 복사해 주세요.')
    window.setTimeout(() => setToast(null), 2500)
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>거시경제 정책 시뮬레이터</h1>
          <p>정책 변수를 움직여 균형이 어떻게 바뀌는지 살펴보세요.</p>
        </div>
        <ModelTabs active={state.model} onSelect={selectModel} />
        <div className="actions">
          <button type="button" className="btn" onClick={share}>
            링크 공유
          </button>
          <button type="button" className="btn ghost-btn" onClick={() => dispatch({ type: 'reset' })}>
            초기화
          </button>
        </div>
      </header>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <main className="layout">
        {/* The slot is the grid item; the panel sticks inside it, so it stops at the end of the row. */}
        <div className="controls-slot">
          <ControlPanel
            key={model.id}
            model={model}
            regime={state.regime}
            values={state.values}
            solution={view.current}
            onSet={(key, value) => dispatch({ type: 'set', key, value })}
            onRegime={(regime) => dispatch({ type: 'regime', regime })}
          />
        </div>
        <div className="center">
          <EquilibriumGraph
            title={model.name}
            axes={model.axes}
            xDomain={view.xDomain}
            yDomain={view.yDomain}
            current={view.current}
            baseline={view.baseline}
            showGhost={ghost}
            onSaveBaseline={() => dispatch({ type: 'saveBaseline' })}
            period={view.current.trajectory ? period : undefined}
            footer={
              view.current.trajectory && (
                <PeriodScrubber
                  period={period}
                  max={maxPeriod}
                  playing={running}
                  onPeriod={(t) => {
                    setPlaying(false)
                    setPeriod(t)
                  }}
                  onToggle={togglePlay}
                />
              )
            }
          />
          <Results model={model} regime={state.regime} current={view.current} baseline={view.baseline} />
          <TimePathPanel paths={view.current.timePaths ?? []} note={model.timePathNote} period={period} />
        </div>
        <ExplanationPanel model={model} sentences={view.sentences} />
      </main>
    </div>
  )
}
