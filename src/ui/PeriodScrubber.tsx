interface Props {
  period: number
  max: number
  playing: boolean
  onPeriod: (t: number) => void
  onToggle: () => void
}

/** Selects the period highlighted on the graph and the time paths. */
export function PeriodScrubber({ period, max, playing, onPeriod, onToggle }: Props) {
  return (
    <div className="scrubber">
      <button type="button" className="btn small" onClick={onToggle} aria-pressed={playing}>
        {playing ? '❚❚ 정지' : '▶ 재생'}
      </button>
      <label htmlFor="period-slider">기간</label>
      <input
        id="period-slider"
        name="period"
        type="range"
        min={0}
        max={max}
        step={1}
        value={period}
        onChange={(e) => onPeriod(Number(e.currentTarget.value))}
      />
      <output htmlFor="period-slider" data-testid="period">
        {period}기
      </output>
    </div>
  )
}
