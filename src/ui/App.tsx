import { useMemo, useState } from 'react'
import { fitDomain } from '../engine'
import { requireModel } from '../state/scenario'
import { ControlPanel } from './ControlPanel'
import { EquilibriumGraph } from './EquilibriumGraph'
import { ExplanationPanel } from './ExplanationPanel'
import { ModelTabs } from './ModelTabs'
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

export default function App() {
  const [state, dispatch] = useScenario()
  const [toast, setToast] = useState<string | null>(null)
  const model = requireModel(state.model)

  const view = useMemo(() => {
    const cur0 = model.solve(state)
    const base0 = model.solve(state.baseline)
    const xDomain = fitDomain(model.axes.x.defaultDomain, [cur0.equilibrium.point.x, base0.equilibrium.point.x])
    const yDomain = fitDomain(model.axes.y.defaultDomain, [cur0.equilibrium.point.y, base0.equilibrium.point.y])
    const baseline = model.solve(state.baseline, { xDomain })
    const current = model.solve(state, { xDomain, baseline })
    const sentences = model.explain({ input: state.baseline, solution: baseline }, { input: state, solution: current })
    return { xDomain, yDomain, baseline, current, sentences }
  }, [model, state])

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
        <ModelTabs active={state.model} onSelect={(m) => dispatch({ type: 'model', model: m })} />
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
        <ControlPanel
          model={model}
          regime={state.regime}
          values={state.values}
          solution={view.current}
          onSet={(key, value) => dispatch({ type: 'set', key, value })}
          onRegime={(regime) => dispatch({ type: 'regime', regime })}
        />
        <div className="center">
          <EquilibriumGraph
            axes={model.axes}
            xDomain={view.xDomain}
            yDomain={view.yDomain}
            current={view.current}
            baseline={view.baseline}
            showGhost={ghost}
            onSaveBaseline={() => dispatch({ type: 'saveBaseline' })}
          />
          <Results model={model} regime={state.regime} current={view.current} baseline={view.baseline} />
        </div>
        <TimePathPanel paths={view.current.timePaths ?? []} />
        <ExplanationPanel model={model} sentences={view.sentences} />
      </main>
    </div>
  )
}
