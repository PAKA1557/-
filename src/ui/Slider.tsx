import { fmt } from '../engine'
import type { VariableSpec } from '../engine/types'

interface Props {
  spec: VariableSpec
  value: number
  onChange: (value: number) => void
}

export function Slider({ spec, value, onChange }: Props) {
  const id = `var-${spec.key}`
  return (
    <div className="control">
      <div className="control-head">
        <label htmlFor={id}>
          {spec.label} <span className="sym">{spec.symbol}</span>
        </label>
        <output htmlFor={id} className="control-value" data-testid={`input-${spec.key}`}>
          {fmt(value, spec.digits)}
          {spec.unit}
        </output>
      </div>
      <input
        id={id}
        name={spec.key}
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <div className="control-range" aria-hidden="true">
        <span>{fmt(spec.min, spec.digits)}</span>
        <span>{fmt(spec.max, spec.digits)}</span>
      </div>
      <p className="hint">{spec.description}</p>
    </div>
  )
}

interface LockedProps {
  spec: VariableSpec
  value: number
  reason: string
  flagged: boolean
}

export function LockedVariable({ spec, value, reason, flagged }: LockedProps) {
  return (
    <div className="control locked" aria-label={`${spec.label} (결과값, 조작 불가)`}>
      <div className="control-head">
        <span className="locked-label">
          <LockIcon /> {spec.label} <span className="sym">{spec.symbol}</span>
        </span>
        <span className={flagged ? 'control-value flag' : 'control-value'} data-testid={`locked-${spec.key}`}>
          {fmt(value, spec.digits)}
          {spec.unit}
        </span>
      </div>
      <p className="hint">
        <strong>결과값</strong> · {reason}
      </p>
    </div>
  )
}

function LockIcon() {
  return (
    <svg className="lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}
