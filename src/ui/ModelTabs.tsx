import { MODELS } from '../engine/registry'
import type { ModelId } from '../engine/types'

interface Props {
  active: ModelId
  onSelect: (id: ModelId) => void
}

export function ModelTabs({ active, onSelect }: Props) {
  return (
    <nav className="tabs" role="tablist" aria-label="모형 선택">
      {MODELS.map((m) => {
        const ready = m.definition !== null
        return (
          <button
            key={m.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={m.id === active}
            aria-disabled={!ready}
            disabled={!ready}
            title={ready ? undefined : '준비 중인 모형입니다'}
            onClick={() => ready && onSelect(m.id)}
          >
            {m.name}
            {!ready && <span className="soon">준비 중</span>}
          </button>
        )
      })}
    </nav>
  )
}
