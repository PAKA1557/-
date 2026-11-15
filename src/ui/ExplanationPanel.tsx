import type { ModelDefinition } from '../engine/types'
import { Tex } from './Tex'

export function ExplanationPanel({ model, sentences }: { model: ModelDefinition; sentences: string[] }) {
  return (
    <section className="panel explain" aria-labelledby="explain-title">
      <h2 id="explain-title">해설</h2>
      <ul className="sentences" aria-live="polite" data-testid="explanation">
        {sentences.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <div className="explain-grid">
        <div>
          <h3>모형 방정식</h3>
          <dl className="equations">
            {model.equations.map((eq) => (
              <div key={eq.label}>
                <dt>{eq.label}</dt>
                <dd>
                  <Tex latex={eq.latex} display />
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h3>용어</h3>
          <dl className="glossary">
            {model.glossary.map((g) => (
              <div key={g.term}>
                <dt>{g.term}</dt>
                <dd>{g.text}</dd>
              </div>
            ))}
          </dl>
          <p className="note">
            이 시뮬레이터는 개념을 익히기 위한 <strong>교육용 단순 모형</strong>이며, 실제 경제에 대한 예측이 아닙니다.
            숫자는 설명을 위해 고른 가상의 값입니다.
          </p>
        </div>
      </div>
    </section>
  )
}
