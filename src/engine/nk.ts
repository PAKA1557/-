/**
 * The canonical three-equation New Keynesian model (one period = one
 * quarter; inflation and interest rates in annualized percent). Output is
 * shown as Y = 100 + x, where x is the output gap in percent (Ȳ = 100).
 * Hats are deviations from target: π̂ = π − π*.
 *
 *   DIS:   x_t = E_t x_{t+1} − (1/(4σ)) (i_t − E_t π_{t+1} − ρ − r̃_t)
 *   NKPC:  π̂_t = β E_t π̂_{t+1} + κ x_t + u_t
 *   MP:    i_t = ρ + π* + φπ π̂_t + φx x_t + v_t
 *   Fisher: r_t = i_t − E_t π_{t+1},   β = 1 / (1 + ρ/400)
 *
 * The 4 in the DIS converts the annual rate gap into a quarterly one.
 * Shocks are AR(1) with an innovation in period 1: z_t = size · ρz^(t−1).
 *
 * Minimum-state-variable solution. With S = 4σ and a single shock z of
 * persistence ρz, guess x_t = ψx z_t and π̂_t = ψπ z_t (so E_t(·)_{t+1} =
 * ρz (·)_t). Writing d = r̃ − v,
 *   Λ(ρz) = [S(1 − ρz) + φx](1 − βρz) + κ(φπ − ρz)
 *   demand / policy (d):  x = (1 − βρz) d / Λ,      π̂ = κ d / Λ
 *   cost push (u):        x = −(φπ − ρz) u / Λ,     π̂ = [S(1 − ρz) + φx] u / Λ
 * The model is linear, so with three shocks of different persistence the
 * path is the sum of the three components.
 *
 * Determinacy (φπ, φx ≥ 0): κ(φπ − 1) + (1 − β)φx > 0 (= Λ(1)). For a
 * determinate rule Λ(ρz) > 0 on [0, 1], so Λ can only vanish when the rule
 * is indeterminate.
 *
 * Period 0 is the baseline's no-shock steady state; the current scenario
 * applies for periods 1 … NK_HORIZON. Nothing is backward-looking, so a
 * change of π* (credible, announced) moves the economy to the new target
 * in period 1 with a zero output gap.
 */
import { fmt } from './islm'
import { clipLine } from './ismppc'
import type {
  Curve,
  LockInfo,
  Marker,
  ModelDefinition,
  Point,
  ScenarioInput,
  Solution,
  SolveOptions,
  StabilityReadout,
  TimePath,
  Values,
  VariableSpec,
  Warning,
} from './types'

/** Number of periods simulated (t = 0 … NK_HORIZON). */
export const NK_HORIZON = 40

/** Natural output, fixed (Y = YBAR + x). */
export const YBAR = 100

export interface NKParams {
  /** Demand (natural-rate) shock r̃ (pp, annualized) and its persistence. */
  dRn: number
  rhoRn: number
  /** Rule coefficients on the inflation gap and the output gap. */
  phiPi: number
  phiX: number
  /** Monetary policy shock v (pp) and its persistence. */
  vShock: number
  rhoV: number
  /** Inflation target π* (%). */
  target: number
  /** Cost-push shock u (pp) and its persistence. */
  uShock: number
  rhoU: number
  /** Inverse intertemporal elasticity of substitution σ. */
  sigma: number
  /** NKPC slope κ. */
  kappa: number
  /** Natural real rate ρ (%, annualized). */
  rnat: number
}

export const NK_DEFAULTS: NKParams = {
  dRn: 0,
  rhoRn: 0.5,
  phiPi: 1.5,
  phiX: 0.5,
  vShock: 0,
  rhoV: 0.5,
  target: 2,
  uShock: 0,
  rhoU: 0.5,
  sigma: 1,
  kappa: 0.5,
  rnat: 2,
}

/** Discount factor implied by the natural rate (quarterly). */
export function betaOf(rnat: number): number {
  return 1 / (1 + rnat / 400)
}

/** Determinacy index κ(φπ − 1) + (1 − β)φx; positive ⇔ determinate. */
export function determinacy(p: Pick<NKParams, 'kappa' | 'phiPi' | 'phiX' | 'rnat'>): number {
  return p.kappa * (p.phiPi - 1) + (1 - betaOf(p.rnat)) * p.phiX
}

/** Band around det = 0 treated as the borderline case. */
const DET_EPS = 1e-9
/** Below this |Λ| there is no MSV solution for a shock of that persistence. */
const LAMBDA_EPS = 1e-9

export type Determinacy = 'determinate' | 'borderline' | 'indeterminate'

export function determinacyOf(p: NKParams): { det: number; status: Determinacy } {
  const det = determinacy(p)
  return { det, status: det > DET_EPS ? 'determinate' : det < -DET_EPS ? 'indeterminate' : 'borderline' }
}

/** Λ(ρz) = [S(1 − ρz) + φx](1 − βρz) + κ(φπ − ρz). */
export function lambdaOf(p: NKParams, rz: number): number {
  const S = 4 * p.sigma
  const beta = betaOf(p.rnat)
  return (S * (1 - rz) + p.phiX) * (1 - beta * rz) + p.kappa * (p.phiPi - rz)
}

/** Impact coefficients (x, π̂ per unit of shock) for the three shocks. */
export function responses(p: NKParams) {
  const S = 4 * p.sigma
  const beta = betaOf(p.rnat)
  const demand = (rz: number) => {
    const L = lambdaOf(p, rz)
    return { x: (1 - beta * rz) / L, pi: p.kappa / L, L }
  }
  const cost = (rz: number) => {
    const L = lambdaOf(p, rz)
    return { x: -(p.phiPi - rz) / L, pi: (S * (1 - rz) + p.phiX) / L, L }
  }
  const rn = demand(p.rhoRn)
  const v = demand(p.rhoV)
  return {
    rn,
    // d = r̃ − v: a policy shock enters with the opposite sign.
    v: { x: -v.x, pi: -v.pi, L: v.L },
    u: cost(p.rhoU),
  }
}

export interface PeriodState {
  t: number
  /** Shocks in this period. */
  rn: number
  v: number
  u: number
  /** Output gap x and inflation gap π̂. */
  x: number
  piHat: number
  Y: number
  pi: number
  i: number
  r: number
  /** E_t x_{t+1} and E_t π_{t+1} (level). */
  Ex: number
  Epi: number
}

/** Period-0 state: the no-shock steady state for a target and natural rate. */
export function steadyState(p: Pick<NKParams, 'target' | 'rnat'>): PeriodState {
  return { t: 0, rn: 0, v: 0, u: 0, x: 0, piHat: 0, Y: YBAR, pi: p.target, i: p.target + p.rnat, r: p.rnat, Ex: 0, Epi: p.target }
}

/** Gaps beyond which a path is no longer reported (pp of inflation, % of Ȳ). */
export const DIVERGENCE_LIMIT = 50

export interface Simulation {
  path: PeriodState[]
  /** 'nosolution': Λ = 0 for an active shock; 'diverged': a gap passed the limit. */
  stopped: null | 'nosolution' | 'diverged'
}

/** Shock z_t = size · ρz^(t−1) for t ≥ 1. */
export function ar1(size: number, rz: number, t: number): number {
  if (t < 1 || size === 0) return 0
  return size * rz ** (t - 1)
}

/** Periods 1 … horizon under `p`, after the period-0 state `start`. */
export function simulate(start: PeriodState, p: NKParams, horizon = NK_HORIZON): Simulation {
  const path: PeriodState[] = [start]
  const R = responses(p)
  const comps: { size: number; rz: number; c: { x: number; pi: number; L: number } }[] = [
    { size: p.dRn, rz: p.rhoRn, c: R.rn },
    { size: p.vShock, rz: p.rhoV, c: R.v },
    { size: p.uShock, rz: p.rhoU, c: R.u },
  ]
  if (comps.some((k) => k.size !== 0 && !(Math.abs(k.c.L) > LAMBDA_EPS))) return { path, stopped: 'nosolution' }
  for (let t = 1; t <= horizon; t++) {
    let x = 0
    let piHat = 0
    let Ex = 0
    let EpiHat = 0
    for (const k of comps) {
      if (k.size === 0) continue
      const z = ar1(k.size, k.rz, t)
      x += k.c.x * z
      piHat += k.c.pi * z
      Ex += k.rz * k.c.x * z
      EpiHat += k.rz * k.c.pi * z
    }
    if (!Number.isFinite(x) || !Number.isFinite(piHat) || Math.abs(x) > DIVERGENCE_LIMIT || Math.abs(piHat) > DIVERGENCE_LIMIT) {
      return { path, stopped: 'diverged' }
    }
    const v = ar1(p.vShock, p.rhoV, t)
    const pi = p.target + piHat
    const Epi = p.target + EpiHat
    const i = p.rnat + p.target + p.phiPi * piHat + p.phiX * x + v
    path.push({ t, rn: ar1(p.dRn, p.rhoRn, t), v, u: ar1(p.uShock, p.rhoU, t), x, piHat, Y: YBAR + x, pi, i, r: i - Epi, Ex, Epi })
  }
  return { path, stopped: null }
}

// ---------------------------------------------------------------------------
// Model definition
// ---------------------------------------------------------------------------

const S_D = '수요 충격 (자연이자율)'
const S_I = '기준금리 (테일러 준칙)'
const S_T = '물가목표'
const S_S = '공급 충격'

const rhoVar = (key: string, symbol: string, section: string, what: string): VariableSpec => ({
  key,
  label: '충격 지속성',
  symbol,
  min: 0,
  max: 0.95,
  step: 0.05,
  default: 0.5,
  group: 'policy',
  digits: 2,
  section,
  description: `${what}이 매 분기 ${symbol}배로 줄어듭니다. 0이면 1기에만 오고, 1에 가까울수록 오래 남습니다.`,
})

const VARIABLES: VariableSpec[] = [
  { key: 'dRn', label: '수요 충격', symbol: 'r̃', unit: '%p', min: -3, max: 3, step: 0.25, default: 0, group: 'policy', digits: 2, section: S_D, description: '소비·투자 의욕 변화로 자연이자율이 움직이는 폭. 양수이면 같은 금리에서 수요가 늘어납니다.' },
  rhoVar('rhoRn', 'ρr', S_D, '수요 충격'),
  { key: 'phiPi', label: '물가 반응 계수', symbol: 'φπ', min: 0, max: 3, step: 0.1, default: 1.5, group: 'policy', digits: 1, section: S_I, description: '물가상승률이 목표보다 1%p 높을 때 명목금리를 φπ%p 올립니다. φπ > 1이어야 실질금리가 오릅니다(테일러 원칙).' },
  { key: 'phiX', label: '산출 갭 반응 계수', symbol: 'φx', min: 0, max: 2, step: 0.1, default: 0.5, group: 'policy', digits: 1, section: S_I, description: '산출 갭이 1%일 때 명목금리를 φx%p 더 올립니다.' },
  { key: 'vShock', label: '통화정책 충격', symbol: 'v', unit: '%p', min: -3, max: 3, step: 0.25, default: 0, group: 'policy', digits: 2, section: S_I, description: '중앙은행이 준칙보다 금리를 더 높게(양수, 긴축) 또는 낮게(음수, 완화) 정하는 폭.' },
  rhoVar('rhoV', 'ρv', S_I, '통화정책 충격'),
  { key: 'Mnk', label: '통화량', symbol: 'M', min: 0, max: 1, step: 1, default: 0, group: 'policy', digits: 0, section: S_I, description: '' },
  { key: 'target', label: '물가목표', symbol: 'π*', unit: '%', min: 0, max: 6, step: 0.5, default: 2, group: 'policy', digits: 1, section: S_T, description: '중앙은행이 발표하고 모두가 믿는 인플레이션 목표. 기준점과 다르게 두면 신뢰받는 목표 변경 실험이 됩니다.' },
  { key: 'uShock', label: '비용 인상 충격', symbol: 'u', unit: '%p', min: -3, max: 3, step: 0.25, default: 0, group: 'policy', digits: 2, section: S_S, description: '유가 급등 같은 비용 충격. 뉴케인지언 필립스 곡선을 위(양수) 또는 아래(음수)로 이동시킵니다.' },
  rhoVar('rhoU', 'ρu', S_S, '비용 인상 충격'),
  { key: 'sigma', label: '상대적 위험회피도(기간 간 대체탄력성의 역수)', symbol: 'σ', min: 0.5, max: 5, step: 0.25, default: 1, group: 'param', digits: 2, description: '클수록 가계가 소비를 미루거나 앞당기지 않아, 실질금리 변화에 수요가 덜 반응합니다.' },
  { key: 'kappa', label: '필립스 곡선 기울기', symbol: 'κ', min: 0.05, max: 2, step: 0.05, default: 0.5, group: 'param', digits: 2, description: '산출 갭 1%당 물가상승률이 κ%p 높아집니다. 가격이 자주 조정될수록 큽니다.' },
  { key: 'rnat', label: '자연이자율', symbol: 'ρ', unit: '%', min: 0.25, max: 5, step: 0.25, default: 2, group: 'param', digits: 2, description: '산출 갭이 0일 때의 실질금리(연율). 할인인자 β = 1/(1 + ρ/400)도 이 값에서 정해집니다.' },
]

const LOCKS: LockInfo[] = [
  {
    key: 'Mnk',
    resultKey: 'Mnk',
    reason: '중앙은행이 준칙에 따라 금리를 정하고, 통화량은 그 금리를 유지하도록 저절로 맞춰집니다(이 모형은 화폐수요를 따로 다루지 않습니다).',
  },
]

export function toNKParams(values: Values): NKParams {
  const p = { ...NK_DEFAULTS }
  for (const key of Object.keys(p) as (keyof NKParams)[]) {
    const v = values[key]
    if (typeof v === 'number' && Number.isFinite(v)) p[key] = v
  }
  return p
}

const DEFAULT_X: [number, number] = [96, 104]
const DEFAULT_Y: [number, number] = [-1, 6]
/** Graph ranges follow at most this many periods of an indeterminate path. */
const DRIFT_FIT_PERIODS = 8

interface CurveInputs {
  /** Target in force (period 0: the baseline's). */
  target: number
  Ex: number
  EpiHat: number
  rn: number
  v: number
  u: number
}

/** NKPC_t: π = π* + β E_t π̂_{t+1} + u_t + κ (Y − Ȳ). */
function nkpcCurve(p: NKParams, c: CurveInputs, xd: [number, number], yd: [number, number], label: string): Curve {
  const beta = betaOf(p.rnat)
  return { id: 'NKPC', label, tone: 'secondary', points: clipLine({ x: YBAR, y: c.target + beta * c.EpiHat + c.u }, p.kappa, xd, yd) }
}

/** AD_t: x (S + φx) = S E_t x_{t+1} + E_t π̂_{t+1} + r̃_t − v_t − φπ π̂, through its point at π̂ = 0. */
function adCurve(p: NKParams, c: CurveInputs, xd: [number, number], yd: [number, number], label: string): Curve {
  const S = 4 * p.sigma
  const k = S + p.phiX
  const through = { x: YBAR + (S * c.Ex + c.EpiHat + c.rn - c.v) / k, y: c.target }
  const slope = Math.abs(p.phiPi) < 1e-12 ? null : -k / p.phiPi
  return { id: 'AD', label, tone: 'primary', points: clipLine(through, slope, xd, yd) }
}

const KEYS = ['Y', 'pi', 'i', 'r'] as const

function suffixed(s: { Y: number; pi: number; i: number; r: number } | null, suffix: string): Values {
  return Object.fromEntries(KEYS.map((k) => [k + suffix, s ? s[k] : Number.NaN]))
}

const STATUS_CODE: Record<Determinacy, number> = { determinate: 1, borderline: 0, indeterminate: -1 }

function stabilityReadout(p: NKParams, det: number, status: Determinacy, noSolution: boolean): StabilityReadout {
  const principle =
    '테일러 원칙: 물가상승률이 1%p 오를 때 명목금리를 1%p보다 더 올리면(φπ > 1) 실질금리가 올라 수요와 물가를 끌어내립니다. ' +
    '그러면 "물가가 오를 것"이라는 기대만으로 물가가 오르는 자기실현적 인플레이션이 생길 수 없어 균형이 하나로 정해집니다. ' +
    '산출 갭 반응 φx는 이 조건을 조금 느슨하게 해 줍니다.'
  let head: string
  if (noSolution) {
    head = '어떤 충격의 지속성에서 Λ = 0이 되어 그 충격에 대한 기본(MSV) 해가 없습니다.'
  } else if (status === 'determinate') {
    head = `결정성 지표가 ${fmt(det, 3)} > 0이라 합리적 기대 균형이 하나뿐입니다(결정적).`
  } else if (status === 'borderline') {
    head = '결정성 지표가 0인 경계입니다. 금리 반응이 조금만 약해져도 균형이 하나로 정해지지 않습니다.'
  } else {
    head = `결정성 지표가 ${fmt(det, 3)} < 0이라 균형이 무수히 많습니다(비결정). 그려진 경로는 그중 하나(MSV 해)입니다.`
  }
  return {
    label: '결정성 지표',
    value: fmt(det, 3),
    status: status === 'determinate' && !noSolution ? 'stable' : status === 'borderline' && !noSolution ? 'unit' : 'unstable',
    statusLabel: noSolution ? '해 없음' : status === 'determinate' ? '결정' : status === 'borderline' ? '경계' : '비결정',
    text: `${head} ${principle}${p.phiX > 0 ? ` (지금은 φx = ${fmt(p.phiX, 1)}이라 φπ가 1보다 약간 작아도 결정적일 수 있습니다.)` : ''}`,
    latex: '\\kappa\\,(\\phi_\\pi - 1) + (1-\\beta)\\,\\phi_x > 0',
  }
}

function solve(input: ScenarioInput, options: SolveOptions = {}): Solution {
  const p = toNKParams(input.values)
  const xd = options.xDomain ?? DEFAULT_X
  const yd = options.yDomain ?? DEFAULT_Y
  const beta = betaOf(p.rnat)

  // Period 0: the baseline's no-shock steady state (or the input's own, without a baseline).
  const bv = options.baseline?.values
  const start = bv && Number.isFinite(bv.target) && Number.isFinite(bv.rnat) ? steadyState({ target: bv.target, rnat: bv.rnat }) : steadyState(p)
  const { path, stopped } = simulate(start, p)
  const { det, status } = determinacyOf(p)
  const noSolution = stopped === 'nosolution'
  const determinate = status === 'determinate' && !noSolution
  const lr = determinate ? { Y: YBAR, pi: p.target, i: p.target + p.rnat, r: p.rnat } : null
  const s1 = path[1] ?? null

  const warnings: Warning[] = []
  if (noSolution) {
    warnings.push({
      key: 'pi1',
      message: '해 없음: 이 계수에서는 충격의 지속성과 준칙이 맞물려 Λ = 0이 되어, 충격에 대한 기본(MSV) 해가 존재하지 않습니다. 0기 이후는 그리지 않았습니다. 계수나 지속성을 조금 바꿔 보세요.',
    })
  }
  if (status === 'indeterminate') {
    warnings.push({
      key: 'piLR',
      message: `비결정: κ(φπ − 1) + (1 − β)φx = ${fmt(det, 3)} < 0이라 테일러 원칙이 깨졌습니다. 물가가 오를 때 실질금리가 충분히 오르지 않아, 근본적인 충격이 없어도 자기실현적 기대(태양흑점)만으로 물가와 산출이 움직이는 균형이 무수히 많습니다. 그려진 경로는 그중 하나(MSV 해)일 뿐입니다.${stopped === 'diverged' ? ` ${path.length}기에 물가상승률이나 산출 갭이 ±${DIVERGENCE_LIMIT}을 넘어 그 이후는 그리지 않았습니다.` : ''}`,
    })
  } else if (status === 'borderline') {
    warnings.push({
      key: 'piLR',
      message: '경계: κ(φπ − 1) + (1 − β)φx = 0이라 결정성의 경계에 있습니다. 금리 반응이 조금만 약해지면 균형이 하나로 정해지지 않습니다(테일러 원칙의 경계).',
    })
  }
  if (stopped === 'diverged' && status !== 'indeterminate') {
    warnings.push({
      key: 'pi1',
      message: `${path.length}기에 물가상승률이나 산출 갭이 ±${DIVERGENCE_LIMIT}을 넘어 그 이후는 그리지 않았습니다. 충격이 매우 오래 지속되고 금리 반응이 약하면 반응이 이렇게 커질 수 있습니다.`,
    })
  }
  if (path.some((s) => s.i < 0)) {
    warnings.push({ key: 'i1', message: '명목금리가 음수가 되는 기간이 있습니다. 이 선형 모형은 금리의 실효하한을 반영하지 않습니다.' })
  }

  const values: Values = {
    ...p,
    Mnk: Number.NaN,
    beta,
    det,
    stability: noSolution ? -2 : STATUS_CODE[status],
    periods: path.length - 1,
    ...suffixed(start, '0'),
    ...suffixed(s1, '1'),
    ...suffixed(lr, 'LR'),
    YT: path.length > NK_HORIZON ? path[NK_HORIZON].Y : Number.NaN,
    piT: path.length > NK_HORIZON ? path[NK_HORIZON].pi : Number.NaN,
  }

  const pts: Point[] = path.map((s) => ({ x: s.Y, y: s.pi }))
  const inputsOf = (s: PeriodState): CurveInputs => ({
    target: s.t === 0 ? start.pi : p.target,
    Ex: s.Ex,
    EpiHat: s.Epi - (s.t === 0 ? start.pi : p.target),
    rn: s.rn,
    v: s.v,
    u: s.u,
  })
  const periodCurves = (c: CurveInputs, t: number): Curve[] => {
    const suffix = t === 1 ? '' : `(${t}기)`
    return [adCurve(p, c, xd, yd, `AD${suffix}`), nkpcCurve(p, c, xd, yd, `NKPC${suffix}`)]
  }
  // Without a period-1 solution, draw period 1's curves with expectations at target.
  const first: CurveInputs = s1 ? inputsOf(s1) : { target: p.target, Ex: 0, EpiHat: 0, rn: ar1(p.dRn, p.rhoRn, 1), v: ar1(p.vShock, p.rhoV, 1), u: ar1(p.uShock, p.rhoU, 1) }
  const curves: Curve[] = [
    ...periodCurves(first, 1),
    { id: 'LRAS', label: 'LRAS', tone: 'reference', points: [{ x: YBAR, y: yd[0] }, { x: YBAR, y: yd[1] }] },
  ]

  const e0 = pts[0]
  const e1 = pts[1] ?? e0
  const markers: Marker[] = [{ point: e0, label: 'E₀', kind: 'baseline' }]
  const near = (u: Point, v: Point) => Math.abs(u.x - v.x) < 1e-6 && Math.abs(u.y - v.y) < 1e-6
  if (!near(e1, e0)) markers.push({ point: e1, label: 'E₁', kind: 'short' })
  if (lr && !near({ x: lr.Y, y: lr.pi }, e0)) markers.push({ point: { x: lr.Y, y: lr.pi }, label: 'E*', kind: 'long' })

  const periods = Array.from({ length: NK_HORIZON + 1 }, (_, t) => String(t))
  const series = (key: (typeof KEYS)[number]) => periods.map((_, t) => (path[t] ? path[t][key] : Number.NaN))
  const timePaths: TimePath[] = [
    { key: 'Y', label: '산출 Y', digits: 2, kind: 'dynamic', periods, values: series('Y'), reference: { value: YBAR, label: 'Ȳ' } },
    { key: 'pi', label: '물가상승률 π', unit: '%', digits: 2, kind: 'dynamic', periods, values: series('pi'), reference: { value: p.target, label: 'π*' } },
    { key: 'i', label: '명목금리 i', unit: '%', digits: 2, kind: 'dynamic', periods, values: series('i'), reference: { value: p.target + p.rnat, label: '정상상태' } },
    { key: 'r', label: '실질금리 r', unit: '%', digits: 2, kind: 'dynamic', periods, values: series('r'), reference: { value: p.rnat, label: 'ρ' } },
  ]

  return {
    values,
    curves,
    equilibrium: { point: e1, label: 'E₁' },
    markers,
    trajectory: {
      points: pts,
      curves: path.map((s) => periodCurves(inputsOf(s), s.t)),
      fitUntil: determinate ? path.length - 1 : Math.min(DRIFT_FIT_PERIODS, path.length - 1),
      curvesFollowPeriod: true,
    },
    timePaths,
    stability: stabilityReadout(p, det, status, noSolution),
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const EPS = 1e-9

/** "ρz = 0.50: …" — how long a shock (and hence its effect) lasts. */
function lastsText(rz: number): string {
  return rz === 0
    ? '지속성이 0이라 충격은 1기에만 있고, 2기에는 바로 정상상태로 돌아옵니다'
    : `충격이 매 분기 ${fmt(rz, 2)}배로 줄어드는 만큼 산출 갭과 인플레이션 갭도 매 분기 ${fmt(rz, 2)}배로 줄어듭니다`
}

/** The forward-looking mechanism and the contrast with IS-MP-PC (one sentence per active shock). */
function forwardNote(rz: number): string {
  return `가계와 기업은 앞을 내다보고 행동하므로 효과는 충격 자체가 남아 있는 동안만 지속됩니다(충격 지속성 ${fmt(rz, 2)}: ${lastsText(rz)}). 반면 IS-MP-PC에서는 기대가 지난 물가를 늦게 따라가므로 충격이 끝난 뒤에도 인플레이션이 한동안 이어집니다.`
}

function chains(p: NKParams, b: NKParams, start: { pi: number }): string[] {
  const out: string[] = []
  const strong = p.phiPi > 1
  if (Math.abs(p.uShock) > EPS) {
    const up = p.uShock > 0
    out.push(
      up
        ? `비용 인상 충격(u = ${fmt(p.uShock, 2)}%p) → NKPC가 위로 이동 → 물가상승률 상승 → 준칙에 따라 중앙은행이 금리를 올려 실질금리 상승 → 수요 감소로 산출 갭이 음수: 물가는 오르는데 산출은 줄어드는 스태그플레이션. 이때 중앙은행은 상충관계에 놓입니다. 물가를 목표로 되돌리려 금리를 더 올리면 산출이 더 줄고, 산출을 지키려 하면 물가가 더 오르므로 물가와 산출 갭을 동시에 안정시킬 수 없습니다(φπ가 클수록 물가는 덜, 산출은 더 움직임). ${forwardNote(p.rhoU)}`
        : `비용 하락(유리한 공급) 충격(u = ${fmt(p.uShock, 2)}%p) → NKPC가 아래로 이동 → 물가상승률 하락 → 중앙은행이 금리를 내려 실질금리 하락 → 산출 증가. 물가는 목표보다 낮고 산출은 자연산출보다 높아, 여기서도 두 목표를 동시에 맞출 수는 없습니다. ${forwardNote(p.rhoU)}`,
    )
  }
  if (Math.abs(p.dRn) > EPS) {
    const up = p.dRn > 0
    out.push(
      `수요 충격(r̃ = ${fmt(p.dRn, 2)}%p, 자연이자율 ${up ? '상승' : '하락'}) → 같은 실질금리에서 소비·투자가 ${up ? '늘어' : '줄어'} AD가 ${up ? '오른쪽' : '왼쪽'}으로 이동 → 산출 갭과 물가상승률이 함께 ${up ? '상승' : '하락'} → 준칙에 따라 금리가 ${up ? '올라' : '내려'} 일부 상쇄. 수요 충격에서는 물가와 산출 갭이 같은 방향으로 움직이므로 두 목표 사이에 상충이 없습니다. 물가에 충분히 강하게 반응할수록(φπ↑) 금리가 자연이자율 변화를 더 따라가 두 갭이 모두 0에 가까워집니다. ${forwardNote(p.rhoRn)}`,
    )
  }
  if (Math.abs(p.vShock) > EPS) {
    const up = p.vShock > 0
    out.push(
      `통화정책 ${up ? '긴축' : '완화'} 충격(v = ${fmt(p.vShock, 2)}%p) → 같은 물가·산출에서 명목금리 ${up ? '인상' : '인하'} → 실질금리 ${up ? '상승' : '하락'} → 수요 ${up ? '감소' : '증가'}로 AD가 ${up ? '왼쪽' : '오른쪽'}으로 이동 → 산출과 물가상승률이 함께 ${up ? '하락' : '상승'}(물가와 산출이 ${up ? '내려가' : '올라가'} 준칙이 반대로 반응하므로 명목금리는 덜 ${up ? '오르거나 오히려 내릴' : '내리거나 오히려 오를'} 수 있지만 실질금리는 ${up ? '오릅니다' : '내립니다'}). ${forwardNote(p.rhoV)}`,
    )
  }
  const anyShock = [p.uShock, p.dRn, p.vShock].some((z) => Math.abs(z) > EPS)
  if (Math.abs(p.target - start.pi) > EPS) {
    const down = p.target < start.pi
    out.push(
      `신뢰받는 물가목표 ${down ? '인하' : '인상'}(π* ${fmt(start.pi, 1)}% → ${fmt(p.target, 1)}%) → 모두가 새 목표를 믿고 앞을 내다보므로 1기 기대인플레이션이 곧바로 새 목표로 옮겨 감 → 물가상승률이 1기에 바로 ${fmt(p.target, 1)}%가 되고 산출 갭은 0${anyShock ? '(충격의 효과는 그 위에 더해짐)' : ''}: 산출 손실 없는 디스인플레이션(희생률 0). IS-MP-PC에서는 기대가 옛 물가를 늦게 따라와 목표를 낮추면 몇 해 동안 산출이 줄었던 것과 대조됩니다. 단, 이는 목표가 완전히 신뢰받고 과거 물가를 보고 가격을 정하는 기업이 없다는 가정에 기댄 결과입니다.`,
    )
  }
  if (Math.abs(p.phiPi - b.phiPi) > EPS || Math.abs(p.phiX - b.phiX) > EPS) {
    out.push(
      `준칙 계수 변경(φπ ${fmt(b.phiPi, 1)} → ${fmt(p.phiPi, 1)}, φx ${fmt(b.phiX, 1)} → ${fmt(p.phiX, 1)}): φπ가 클수록 AD가 완만해져 충격에 물가가 덜 움직이고, 비용 충격에서는 그 대가로 산출이 더 움직입니다. φx가 클수록 AD가 가팔라져 산출 변동이 줄어듭니다.${strong ? '' : ' φπ ≤ 1이면 테일러 원칙이 깨질 수 있습니다(결정성 지표 참고).'}`,
    )
  }
  const pnames: [keyof NKParams, string][] = [['sigma', 'σ'], ['kappa', 'κ'], ['rnat', 'ρ']]
  for (const [k, sym] of pnames) {
    if (Math.abs(p[k] - b[k]) <= EPS) continue
    const up = p[k] > b[k]
    const text: Record<string, string> = {
      sigma: `σ ${up ? '상승' : '하락'} → 가계가 실질금리 변화에 소비 시점을 ${up ? '덜' : '더'} 바꿈 → AD가 ${up ? '가팔라지고' : '완만해지고'} 금리 정책의 산출 효과가 ${up ? '약해짐' : '강해짐'}`,
      kappa: `필립스 곡선 기울기 κ ${up ? '상승' : '하락'} → NKPC가 ${up ? '가팔라짐' : '완만해짐'} → 같은 산출 갭에 물가가 ${up ? '더' : '덜'} 반응(가격이 ${up ? '더 자주' : '덜 자주'} 조정됨)`,
      rnat: `자연이자율 ρ ${up ? '상승' : '하락'} → 준칙도 같은 ρ를 쓰므로 정상상태의 산출·물가상승률은 그대로이고 명목·실질금리만 ${fmt(p.rnat - b.rnat, 2)}%p 바뀜(β도 ${up ? '조금 작아짐' : '조금 커짐'})`,
    }
    out.push(`${text[k]}. (${sym}: ${fmt(b[k], 2)} → ${fmt(p[k], 2)})`)
  }
  return out
}

function explain(baseline: { input: ScenarioInput; solution: Solution }, current: { input: ScenarioInput; solution: Solution }): string[] {
  const p = toNKParams(current.input.values)
  const b = toNKParams(baseline.input.values)
  const v = current.solution.values
  const out = chains(p, b, { pi: v.pi0 })
  const moved = [...KEYS].some((k) => {
    const ys = current.solution.timePaths?.find((t) => t.key === k)?.values ?? []
    return ys.some((y, t) => t > 0 && (!Number.isFinite(y) || Math.abs(y - ys[0]) > 1e-9))
  })
  if (out.length === 0 && !moved) {
    return ['경제가 정상상태(Y = Ȳ, π = π*, r = ρ)에 있습니다. 수요·통화정책·비용 인상 충격을 주거나 준칙 계수와 물가목표를 바꾸면, 1기에 무엇이 일어나고 이후 분기마다 어떻게 돌아오는지 여기에 설명이 나타납니다.']
  }
  if (v.stability === -1) out.push('주의: 이 준칙은 테일러 원칙을 어겨 균형이 하나로 정해지지 않습니다(비결정). 그려진 경로는 무수히 많은 균형 가운데 하나일 뿐입니다.')
  if (!moved) return out

  if (Number.isFinite(v.Y1)) {
    out.push(
      `1기(충격 직후): 산출 Y ${fmt(v.Y0, 2)} → ${fmt(v.Y1, 2)}, 물가상승률 π ${fmt(v.pi0, 2)}% → ${fmt(v.pi1, 2)}%, 명목금리 i ${fmt(v.i0, 2)}% → ${fmt(v.i1, 2)}%, 실질금리 r ${fmt(v.r0, 2)}% → ${fmt(v.r1, 2)}%.`,
    )
  }
  if (v.stability === 1 && Number.isFinite(v.YLR)) {
    const pis = current.solution.timePaths?.find((t) => t.key === 'pi')?.values ?? []
    const ys = current.solution.timePaths?.find((t) => t.key === 'Y')?.values ?? []
    let at: number | null = null
    for (let t = pis.length - 1; t >= 1; t--) {
      if (Math.abs(pis[t] - v.piLR) < 0.01 && Math.abs(ys[t] - v.YLR) < 0.01) at = t
      else break
    }
    out.push(
      `장기: 모든 충격이 사라지면 산출 ${fmt(v.YLR, 2)}, 물가상승률 ${fmt(v.piLR, 2)}%(목표), 명목금리 ${fmt(v.iLR, 2)}%, 실질금리 ${fmt(v.rLR, 2)}%로 돌아옵니다.${at !== null && at > 1 ? ` ${at}기부터 산출과 물가상승률이 장기값과 0.01 미만으로 다릅니다.` : ''}`,
    )
  }
  return out
}

export const nkModel: ModelDefinition = {
  id: 'nk',
  name: '뉴케인지언',
  variables: VARIABLES,
  regimes: [{ id: 'taylor', label: '테일러 준칙', description: '중앙은행이 매 분기 물가상승률과 산출 갭에 반응해 명목금리를 정합니다(통화량은 결과값). 한 기간은 1분기이고 금리와 물가상승률은 연율입니다.' }],
  defaultRegime: 'taylor',
  regimeLabel: '통화정책 운영 방식',
  outputs: [
    { key: 'Y1', label: '1기 산출', symbol: 'Y₁', digits: 2 },
    { key: 'pi1', label: '1기 물가상승률', symbol: 'π₁', unit: '%', digits: 2 },
    { key: 'i1', label: '1기 명목금리', symbol: 'i₁', unit: '%', digits: 2 },
    { key: 'r1', label: '1기 실질금리', symbol: 'r₁', unit: '%', digits: 2 },
    { key: 'YLR', label: '장기 산출', symbol: 'Y*', digits: 2 },
    { key: 'piLR', label: '장기 물가상승률', symbol: 'πᴸᴿ', unit: '%', digits: 2 },
  ],
  axes: {
    x: { key: 'Y', label: '산출 Y', digits: 2, defaultDomain: DEFAULT_X },
    y: { key: 'π', label: '물가상승률 π', unit: '%', digits: 2, defaultDomain: DEFAULT_Y },
  },
  equations: [
    { label: '동태적 IS (DIS, r̃: 수요 충격, x = Y − Ȳ)', latex: 'x_t = E_t x_{t+1} - \\dfrac{1}{4\\sigma}\\left(i_t - E_t\\pi_{t+1} - \\rho - \\tilde r_t\\right)' },
    { label: '피셔 방정식', latex: 'r_t = i_t - E_t\\pi_{t+1}' },
    { label: '뉴케인지언 필립스 곡선 NKPC (u: 비용 인상 충격)', latex: '\\pi_t - \\pi^* = \\beta\\,(E_t\\pi_{t+1} - \\pi^*) + \\kappa\\,x_t + u_t' },
    { label: '통화정책 준칙 MP (v: 통화정책 충격)', latex: 'i_t = \\rho + \\pi^* + \\phi_\\pi(\\pi_t - \\pi^*) + \\phi_x\\,x_t + v_t' },
    { label: '할인인자 (자연이자율에서 정해짐)', latex: '\\beta = \\dfrac{1}{1 + \\rho/400}' },
    { label: '해의 공통 분모 (S = 4σ, 충격마다 자기 지속성 ρz로 계산)', latex: '\\Lambda(\\rho_z) = [S(1-\\rho_z) + \\phi_x](1-\\beta\\rho_z) + \\kappa(\\phi_\\pi - \\rho_z)' },
    { label: '해: 산출 갭 (충격 z_t = 크기·ρz^(t−1))', latex: 'x_t = \\dfrac{(1-\\beta\\rho_z)(\\tilde r_t - v_t) - (\\phi_\\pi - \\rho_z)\\,u_t}{\\Lambda}' },
    { label: '해: 인플레이션 갭', latex: '\\pi_t - \\pi^* = \\dfrac{\\kappa(\\tilde r_t - v_t) + [S(1-\\rho_z)+\\phi_x]\\,u_t}{\\Lambda}' },
  ],
  glossary: [
    { term: '동태적 IS', text: '오늘의 산출 갭이 내일 예상되는 산출 갭과 실질금리에 달려 있다는 관계. 실질금리가 자연이자율보다 높으면 가계가 소비를 미뤄 수요가 줄어듭니다.' },
    { term: '뉴케인지언 필립스 곡선', text: '가격을 가끔씩만 바꾸는 기업이 앞으로의 물가를 내다보고 가격을 정하므로, 오늘의 물가상승률이 내일 예상 물가상승률과 산출 갭으로 정해진다는 관계.' },
    { term: '합리적 기대', text: '사람들이 모형의 구조와 정책을 알고, 평균적으로 틀리지 않게 미래를 예상한다는 가정. 이 모형에서 기대는 과거가 아니라 앞으로의 경로를 따릅니다.' },
    { term: '결정성/비결정성', text: '합리적 기대 균형이 하나뿐이면 결정적, 무수히 많으면 비결정적입니다. 비결정이면 근거 없는 기대(태양흑점)만으로도 물가와 산출이 움직일 수 있습니다.' },
    { term: '테일러 원칙', text: '물가상승률이 1%p 오르면 명목금리를 1%p보다 더 올려야 한다는 원칙(φπ > 1). 이 모형에서는 κ(φπ − 1) + (1 − β)φx > 0이 균형이 하나로 정해질 조건입니다.' },
    { term: '자연이자율', text: '산출 갭을 0으로 만드는 실질금리 ρ. 수요 충격 r̃는 이 자연이자율을 일시적으로 바꿉니다.' },
    { term: '비용 인상 충격과 상충관계', text: '비용 인상 충격은 물가를 올리고 산출을 줄이므로, 중앙은행은 물가 안정과 산출 안정 가운데 하나를 어느 정도 포기해야 합니다. 수요 충격에는 이런 상충이 없습니다.' },
  ],
  timePathNote: `한 기간은 1분기이고, 물가상승률과 금리는 연율(%)입니다. 충격은 1기에 시작되어 매 분기 ρz배로 줄어들며 ${NK_HORIZON}기까지 계산합니다. 0기는 기준점의 정상상태(충격 없음)입니다. 아래 기간 슬라이더로 특정 분기의 AD·NKPC를 그래프에서 볼 수 있습니다.`,
  lockedVariables: () => LOCKS,
  solve,
  explain,
}
