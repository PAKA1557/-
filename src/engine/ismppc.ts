/**
 * IS-MP-PC: the dynamic AD-AS model in textbook form (one period = one year),
 * with an expectations-anchoring parameter λ and a policy-rule shock e.
 * All variables are in percent; output is measured so that Ȳ = 100.
 *
 *   IS:            Y_t = Ȳ − α (r_t − ρ) + ε_t
 *   Fisher:        r_t = i_t − E_t π_{t+1}
 *   PC:            π_t = E_{t−1} π_t + φ (Y_t − Ȳ) + ν_t
 *   Expectations:  E_t π_{t+1} = λ π* + (1 − λ) π_t
 *   MP rule:       i_t = π_t + ρ + θπ (π_t − π*) + θY (Y_t − Ȳ) + e_t
 *
 * Reduced form. Write x_t = π_t − π*, g_t = Y_t − Ȳ, u_t = E_{t−1}π_t − π*.
 * Substituting the rule and expectations into Fisher gives
 *   r_t − ρ = (λ + θπ) x_t + θY g_t + e_t,
 * so the IS curve becomes the dynamic AD curve (DAD)
 *   g_t = s_t − A x_t,   s_t = (ε_t − α e_t) / (1 + α θY),   A = α (λ + θπ) / (1 + α θY).
 * With the PC (DAS) x_t = u_t + ν_t + φ g_t:
 *   x_t = (u_t + ν_t + φ s_t) / (1 + φ A),
 * and expectations carry the gap forward: u_{t+1} = (1 − λ) x_t. Hence
 *   x_t = c x_{t−1} + (shock terms),   c = (1 − λ) / (1 + φ A).
 * Stable iff |c| < 1, i.e. |1 − λ| < |1 + φ α (λ + θπ) / (1 + α θY)|.
 * With λ = 0 this is the Taylor principle θπ > 0 (c < 1); θπ = 0 is a unit root.
 *
 * Period 0 is the baseline's no-shock steady state (Y = Ȳ₀, π = π*₀,
 * i = π*₀ + ρ₀, r = ρ₀, E₀π₁ = π*₀). The current scenario's parameters and
 * shocks apply from period 1 to ISMPPC_HORIZON.
 */
import { fmt } from './islm'
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

/** Number of periods simulated (t = 0 … ISMPPC_HORIZON). */
export const ISMPPC_HORIZON = 40

/** Shock persistence: 0 = one period, 1 = N periods, 2 = permanent. */
export type Persistence = 0 | 1 | 2

export interface ISMPPCParams {
  /** Natural output Ȳ. */
  Ybar: number
  /** Inflation target π* (%). */
  piStar: number
  /** Natural real interest rate ρ (%). */
  rho: number
  /** Interest sensitivity of demand α. */
  alpha: number
  /** Phillips-curve slope φ. */
  phi: number
  /** Rule coefficient on the inflation gap θπ. */
  thPi: number
  /** Rule coefficient on the output gap θY. */
  thY: number
  /** Expectations anchoring λ ∈ [0, 1]. */
  lambda: number
  /** Demand shock: change in government spending, % of natural output. */
  dG: number
  gMode: number
  gN: number
  /** Monetary policy shock e (pp), deviation from the rule. */
  eShock: number
  eMode: number
  eN: number
  /** Supply (cost-push) shock ν (pp). */
  nu: number
  nuMode: number
  nuN: number
  /** One-off shock to E₀π₁ (pp), period 1 only. */
  expShock: number
}

export const ISMPPC_DEFAULTS: ISMPPCParams = {
  Ybar: 100,
  piStar: 2,
  rho: 2,
  alpha: 1,
  phi: 0.25,
  thPi: 0.5,
  thY: 0.5,
  lambda: 0,
  dG: 0,
  gMode: 0,
  gN: 4,
  eShock: 0,
  eMode: 0,
  eN: 4,
  nu: 0,
  nuMode: 0,
  nuN: 4,
  expShock: 0,
}

/** Size of a shock in period t given its persistence choice. */
export function shockAt(size: number, mode: number, n: number, t: number): number {
  if (t < 1 || size === 0) return 0
  const m = Math.round(mode)
  if (m === 2) return size
  const last = m === 1 ? Math.max(1, Math.round(n)) : 1
  return t <= last ? size : 0
}

export interface Shocks {
  /** IS shock ε_t in output units. */
  eps: number
  /** Rule deviation e_t. */
  e: number
  /** Cost-push ν_t. */
  nu: number
}

export function shocksAt(p: ISMPPCParams, t: number): Shocks {
  return {
    eps: shockAt((p.dG * p.Ybar) / 100, p.gMode, p.gN, t),
    e: shockAt(p.eShock, p.eMode, p.eN, t),
    nu: shockAt(p.nu, p.nuMode, p.nuN, t),
  }
}

/** Reduced-form coefficients: DAD g = s − A x; DAS x = u + ν + φ g; x = c x₋₁ + … */
export function coefficients(p: ISMPPCParams) {
  const D = 1 + p.alpha * p.thY
  const A = (p.alpha * (p.lambda + p.thPi)) / D
  const den = 1 + p.phi * A
  return { D, A, den, c: (1 - p.lambda) / den }
}

/** Below this |1 + φA| the DAD and DAS are (numerically) parallel. */
const PARALLEL_EPS = 1e-9
/** Unit-root band around |c| = 1. */
const UNIT_EPS = 1e-9

export type StabilityStatus = 'stable' | 'unit' | 'unstable' | 'parallel'

export function stabilityOf(p: ISMPPCParams): { c: number; status: StabilityStatus } {
  const { den, c } = coefficients(p)
  if (Math.abs(den) < PARALLEL_EPS) return { c: Number.NaN, status: 'parallel' }
  const a = Math.abs(c)
  return { c, status: a < 1 - UNIT_EPS ? 'stable' : a <= 1 + UNIT_EPS ? 'unit' : 'unstable' }
}

/** Inflation persistence at λ = 0: c = 1 / (1 + φ α θπ / (1 + α θY)). */
export function persistenceAdaptive(p: Pick<ISMPPCParams, 'alpha' | 'phi' | 'thPi' | 'thY'>): number {
  return 1 / (1 + (p.phi * p.alpha * p.thPi) / (1 + p.alpha * p.thY))
}

export interface PeriodState {
  t: number
  /** E_{t−1} π_t used in this period's Phillips curve (period 1 includes the expectation shock). */
  Eprev: number
  eps: number
  e: number
  nu: number
  Y: number
  pi: number
  i: number
  r: number
  /** E_t π_{t+1}. */
  Enext: number
}

/** Period-0 state: the no-shock steady state of a parameter set. */
export function steadyState(p: Pick<ISMPPCParams, 'Ybar' | 'piStar' | 'rho'>): PeriodState {
  return { t: 0, Eprev: p.piStar, eps: 0, e: 0, nu: 0, Y: p.Ybar, pi: p.piStar, i: p.piStar + p.rho, r: p.rho, Enext: p.piStar }
}

/** Solve one period in closed form given E_{t−1}π_t and the shocks. Null when DAD ∥ DAS. */
export function solvePeriod(p: ISMPPCParams, Eprev: number, sh: Shocks, t: number): PeriodState | null {
  const { D, A, den } = coefficients(p)
  if (Math.abs(den) < PARALLEL_EPS) return null
  const s = (sh.eps - p.alpha * sh.e) / D
  const u = Eprev - p.piStar
  const x = (u + sh.nu + p.phi * s) / den
  const g = s - A * x
  const pi = p.piStar + x
  const Y = p.Ybar + g
  const i = pi + p.rho + p.thPi * x + p.thY * g + sh.e
  const Enext = p.lambda * p.piStar + (1 - p.lambda) * pi
  return { t, Eprev, ...sh, Y, pi, i, r: i - Enext, Enext }
}

/** Gaps beyond which a diverging path is no longer reported (pp of inflation, % of Ȳ for output). */
export const DIVERGENCE_LIMIT = 50

export interface Simulation {
  /** Periods 0 … n (n = horizon unless the path was stopped). */
  path: PeriodState[]
  /** Set when the path was stopped early: 'parallel' (no intersection) or 'diverged'. */
  stopped: null | 'parallel' | 'diverged'
}

/** Periods 1 … horizon under `p`, starting from `start` (period 0, which supplies E₀π₁). */
export function simulate(start: PeriodState, p: ISMPPCParams, horizon = ISMPPC_HORIZON): Simulation {
  const path: PeriodState[] = [start]
  for (let t = 1; t <= horizon; t++) {
    const Eprev = path[t - 1].Enext + (t === 1 ? p.expShock : 0)
    const s = solvePeriod(p, Eprev, shocksAt(p, t), t)
    if (!s) return { path, stopped: 'parallel' }
    const tooFar =
      !Number.isFinite(s.Y) ||
      !Number.isFinite(s.pi) ||
      Math.abs(s.pi - p.piStar) > DIVERGENCE_LIMIT ||
      Math.abs(s.Y - p.Ybar) > (DIVERGENCE_LIMIT * p.Ybar) / 100
    if (tooFar) return { path, stopped: 'diverged' }
    path.push(s)
  }
  return { path, stopped: null }
}

export interface LongRun {
  Y: number
  pi: number
  i: number
  r: number
}

/**
 * Long-run rest point when the path is stable: the steady state, or, with
 * permanent shocks, x* = (ν + φ s) / (λ + φ A) and g* = s − A x*.
 */
export function longRun(p: ISMPPCParams): LongRun | null {
  if (stabilityOf(p).status !== 'stable') return null
  const { D, A } = coefficients(p)
  // Shocks still active in the long run (only permanent ones).
  const permanent = shocksAt(p, Number.POSITIVE_INFINITY)
  const s = (permanent.eps - p.alpha * permanent.e) / D
  const x = (permanent.nu + p.phi * s) / (p.lambda + p.phi * A)
  const g = s - A * x
  const pi = p.piStar + x
  const i = pi + p.rho + p.thPi * x + p.thY * g + permanent.e
  const Enext = p.lambda * p.piStar + (1 - p.lambda) * pi
  return { Y: p.Ybar + g, pi, i, r: i - Enext }
}

// ---------------------------------------------------------------------------
// Model definition
// ---------------------------------------------------------------------------

const MODE_CHOICES = [
  { value: 0, label: '일시적(1기)' },
  { value: 1, label: '지속(N기)' },
  { value: 2, label: '영구적' },
]

const modeVar = (key: string, section: string, what: string): VariableSpec => ({
  key,
  label: '지속성',
  symbol: '',
  min: 0,
  max: 2,
  step: 1,
  default: 0,
  group: 'policy',
  digits: 0,
  section,
  choices: MODE_CHOICES,
  description: `${what}이 1기에만 오는지, 1기부터 N기 동안 이어지는지, 계속되는지를 고릅니다.`,
})

const nVar = (key: string, modeKey: string, section: string): VariableSpec => ({
  key,
  label: '지속 기간',
  symbol: 'N',
  unit: '기',
  min: 2,
  max: 20,
  step: 1,
  default: 4,
  group: 'policy',
  digits: 0,
  section,
  visibleWhen: { key: modeKey, equals: 1 },
  description: '충격이 1기부터 N기까지 이어진 뒤 사라집니다.',
})

const S_G = '재정지출 (수요 충격)'
const S_I = '기준금리 (테일러 준칙)'
const S_E = '기대인플레이션'
const S_S = '공급 충격'

const VARIABLES: VariableSpec[] = [
  { key: 'dG', label: '재정지출 변화', symbol: 'ΔG', unit: '%', min: -5, max: 5, step: 0.5, default: 0, group: 'policy', digits: 1, section: S_G, description: '자연산출 대비 %로 나타낸 정부지출 변화. IS 식의 수요 충격 ε로 들어가 DAD를 이동시킵니다.' },
  modeVar('gMode', S_G, '재정지출 변화'),
  nVar('gN', 'gMode', S_G),
  { key: 'thPi', label: '물가 반응 계수', symbol: 'θπ', min: -1, max: 2, step: 0.1, default: 0.5, group: 'policy', digits: 1, section: S_I, description: '물가상승률이 목표보다 1%p 높을 때 명목금리를 (1 + θπ)%p 올립니다. θπ < 0이면 테일러 원칙이 깨집니다.' },
  { key: 'thY', label: '산출 반응 계수', symbol: 'θY', min: 0, max: 2, step: 0.1, default: 0.5, group: 'policy', digits: 1, section: S_I, description: '산출이 자연산출보다 1% 높을 때 명목금리를 θY%p 더 올립니다.' },
  { key: 'eShock', label: '준칙 이탈 충격', symbol: 'e', unit: '%p', min: -3, max: 3, step: 0.25, default: 0, group: 'policy', digits: 2, section: S_I, description: '중앙은행이 준칙보다 금리를 더 높게(양수, 긴축) 또는 낮게(음수, 완화) 정하는 폭.' },
  modeVar('eMode', S_I, '준칙 이탈'),
  nVar('eN', 'eMode', S_I),
  { key: 'Mend', label: '통화량', symbol: 'M', min: 0, max: 1, step: 1, default: 0, group: 'policy', digits: 0, section: S_I, description: '' },
  { key: 'lambda', label: '기대 고정 정도', symbol: 'λ', min: 0, max: 1, step: 0.05, default: 0, group: 'policy', digits: 2, section: S_E, description: '기대인플레이션 = λ·π* + (1 − λ)·이번 기 물가상승률. 0이면 적응적 기대, 1이면 기대가 목표에 완전히 고정됩니다.' },
  { key: 'piStar', label: '물가목표', symbol: 'π*', unit: '%', min: 0, max: 6, step: 0.5, default: 2, group: 'policy', digits: 1, section: S_E, description: '중앙은행의 인플레이션 목표. 기준점보다 낮추면 디스인플레이션 실험이 됩니다(경제는 옛 목표의 정상상태에서 출발).' },
  { key: 'expShock', label: '기대 충격', symbol: 'Δπe', unit: '%p', min: -3, max: 3, step: 0.25, default: 0, group: 'policy', digits: 2, section: S_E, description: '1기에 적용되는 기대인플레이션 E₀π₁만 이만큼 올리거나 내립니다(한 번뿐인 충격).' },
  { key: 'nu', label: '비용 인상 충격', symbol: 'ν', unit: '%p', min: -3, max: 3, step: 0.25, default: 0, group: 'policy', digits: 2, section: S_S, description: '유가 급등 같은 비용 충격. 필립스 곡선(DAS)을 위(양수) 또는 아래(음수)로 이동시킵니다.' },
  modeVar('nuMode', S_S, '공급 충격'),
  nVar('nuN', 'nuMode', S_S),
  { key: 'alpha', label: '수요의 실질금리 민감도', symbol: 'α', min: 0.2, max: 2, step: 0.1, default: 1, group: 'param', digits: 1, description: '실질금리가 자연이자율보다 1%p 높을 때 산출이 자연산출 대비 α% 줄어듭니다.' },
  { key: 'phi', label: '필립스 곡선 기울기', symbol: 'φ', min: 0.05, max: 1, step: 0.05, default: 0.25, group: 'param', digits: 2, description: '산출 갭 1%당 물가상승률이 기대보다 φ%p 높아집니다. 클수록 DAS가 가팔라집니다.' },
  { key: 'rho', label: '자연이자율', symbol: 'ρ', unit: '%', min: 0, max: 5, step: 0.25, default: 2, group: 'param', digits: 2, description: '산출이 자연산출과 같아지는 실질금리. 준칙도 이 값을 기준으로 금리를 정합니다.' },
  { key: 'Ybar', label: '자연산출', symbol: 'Ȳ', min: 90, max: 110, step: 1, default: 100, group: 'param', digits: 0, description: '장기 수직선 LRAS의 위치. 기본값 100으로 두면 산출을 자연산출 대비 %로 읽을 수 있습니다.' },
]

const LOCKS: LockInfo[] = [
  {
    key: 'Mend',
    resultKey: 'Mend',
    reason: '중앙은행이 준칙에 따라 금리를 정하고, 통화량은 그 금리를 유지하도록 저절로 맞춰집니다(이 모형은 화폐수요를 따로 다루지 않습니다).',
  },
]

export function toISMPPCParams(values: Values): ISMPPCParams {
  const p = { ...ISMPPC_DEFAULTS }
  for (const key of Object.keys(p) as (keyof ISMPPCParams)[]) {
    const v = values[key]
    if (typeof v === 'number' && Number.isFinite(v)) p[key] = v
  }
  for (const k of ['gMode', 'eMode', 'nuMode', 'gN', 'eN', 'nuN'] as const) p[k] = Math.round(p[k])
  return p
}

const DEFAULT_X: [number, number] = [94, 106]
const DEFAULT_Y: [number, number] = [-1, 6]
/** Graph ranges follow at most this many periods of a path that does not settle. */
const DRIFT_FIT_PERIODS = 8

/**
 * The part of the line through `p0` with slope dπ/dY (null = vertical) that
 * lies in the box, as two points sorted by x. Falls back to the box's
 * x-ends when the line misses the box (it is clipped away when drawn).
 */
export function clipLine(p0: Point, slope: number | null, xd: [number, number], yd: [number, number]): Point[] {
  const dir = slope === null ? { x: 0, y: 1 } : { x: 1, y: slope }
  let t0 = Number.NEGATIVE_INFINITY
  let t1 = Number.POSITIVE_INFINITY
  const edges: [number, number, number, number][] = [
    [dir.x, p0.x, xd[0], xd[1]],
    [dir.y, p0.y, yd[0], yd[1]],
  ]
  for (const [d, o, lo, hi] of edges) {
    if (d === 0) {
      if (o < lo || o > hi) t0 = Number.POSITIVE_INFINITY
      continue
    }
    const a = (lo - o) / d
    const b = (hi - o) / d
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  if (!(t0 <= t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) {
    if (slope === null) return [{ x: p0.x, y: yd[0] }, { x: p0.x, y: yd[1] }]
    return [xd[0], xd[1]].map((x) => ({ x, y: p0.y + slope * (x - p0.x) }))
  }
  const pts = [t0, t1].map((t) => ({ x: p0.x + dir.x * t, y: p0.y + dir.y * t }))
  return pts.sort((u, v) => u.x - v.x || u.y - v.y)
}

/** DAD of a period: g = s − A x through (Ȳ + s, π*). */
function dadCurve(p: ISMPPCParams, sh: Shocks, xd: [number, number], yd: [number, number], id: string, label: string): Curve {
  const { D, A } = coefficients(p)
  const s = (sh.eps - p.alpha * sh.e) / D
  const through = { x: p.Ybar + s, y: p.piStar }
  const slope = Math.abs(A) < 1e-12 ? null : -1 / A
  return { id, label, tone: 'primary', points: clipLine(through, slope, xd, yd) }
}

/** DAS of a period: π = E_{t−1}π_t + ν + φ (Y − Ȳ). */
function dasCurve(p: ISMPPCParams, Eprev: number, nu: number, xd: [number, number], yd: [number, number], id: string, label: string): Curve {
  return { id, label, tone: 'secondary', points: clipLine({ x: p.Ybar, y: Eprev + nu }, p.phi, xd, yd) }
}

const KEYS = ['Y', 'pi', 'i', 'r'] as const

function suffixed(s: { Y: number; pi: number; i: number; r: number } | null, suffix: string): Values {
  return Object.fromEntries(KEYS.map((k) => [k + suffix, s ? s[k] : Number.NaN]))
}

const STATUS_CODE: Record<StabilityStatus, number> = { stable: 1, unit: 0, unstable: -1, parallel: -2 }

function stabilityReadout(p: ISMPPCParams, c: number, status: StabilityStatus): StabilityReadout {
  const realReaction = p.lambda + p.thPi
  const principle =
    '테일러 원칙: 물가상승률이 1%p 오를 때 명목금리를 1%p보다 더 올려야(θπ > 0) 실질금리가 올라 수요와 물가를 끌어내립니다. ' +
    'θπ < 0이면 명목금리가 물가상승률보다 덜 올라 실질금리가 오히려 떨어지고, 수요가 늘어 물가가 더 오르는 악순환으로 인플레이션이 폭주합니다.'
  const anchor =
    p.lambda > 0
      ? ` 기대가 목표에 묶여 있으면(λ = ${fmt(p.lambda, 2)}) 실질금리가 물가 1%p당 λ + θπ = ${fmt(realReaction, 2)}%p 움직이므로, 이 모형의 조건은 θπ > −λ로 완화됩니다.`
      : ''
  let head: string
  if (status === 'parallel') {
    head = 'DAD와 DAS의 기울기가 같아(1 + φA = 0) 두 곡선이 만나지 않습니다. 균형이 없습니다.'
  } else if (status === 'stable') {
    head =
      c < 0
        ? `|c| < 1이라 경로는 수렴하지만 c < 0이어서 인플레이션 갭의 부호가 매기 바뀌며 진동합니다(DAD가 DAS보다 완만한 우상향이 되는 비정상적인 경우).`
        : c === 0
          ? `c = 0: 기대가 목표에 완전히 고정되어 충격이 끝나면 바로 다음 기에 정상상태로 돌아옵니다.`
          : `|c| < 1: 충격 뒤 인플레이션 갭이 매기 ${fmt(c, 3)}배로 줄어 정상상태로 돌아옵니다(안정).`
  } else if (status === 'unit') {
    head = `|c| = 1: 충격이 남긴 인플레이션 갭이 줄지도 커지지도 않고 그대로 남습니다(실질금리가 물가에 반응하지 않음).`
  } else {
    head = `|c| > 1: 인플레이션 갭이 매기 ${fmt(Math.abs(c), 3)}배로 커집니다(불안정).`
  }
  return {
    label: '인플레이션 지속성 계수 c',
    value: status === 'parallel' ? '—' : fmt(c, 3),
    status: status === 'parallel' ? 'unstable' : status,
    text: `${head} ${principle}${anchor}`,
    latex: 'c = \\dfrac{1-\\lambda}{1 + \\dfrac{\\phi\\,\\alpha\\,(\\lambda+\\theta_\\pi)}{1+\\alpha\\theta_Y}},\\qquad \\text{안정} \\iff |c| < 1',
  }
}

function solve(input: ScenarioInput, options: SolveOptions = {}): Solution {
  const p = toISMPPCParams(input.values)
  const xd = options.xDomain ?? DEFAULT_X
  const yd = options.yDomain ?? DEFAULT_Y

  // Period 0: the baseline's no-shock steady state (or the input's own, without a baseline).
  const bv = options.baseline?.values
  const start: PeriodState =
    bv && Number.isFinite(bv.Ybar) && Number.isFinite(bv.piStar) && Number.isFinite(bv.rho) ? steadyState({ Ybar: bv.Ybar, piStar: bv.piStar, rho: bv.rho }) : steadyState(p)
  const { path, stopped } = simulate(start, p)
  const { c, status } = stabilityOf(p)
  const lr = longRun(p)
  const s1 = path[1] ?? null

  const warnings: Warning[] = []
  const realReaction = p.lambda + p.thPi
  if (status === 'unstable') {
    const where = stopped === 'diverged' ? ` ${path.length}기에 물가상승률이나 산출 갭이 ±${DIVERGENCE_LIMIT}을 넘어 그 이후는 그리지 않았습니다.` : ''
    warnings.push({
      key: 'piLR',
      message: `불안정: 지속성 계수 |c| = ${fmt(Math.abs(c), 3)} > 1이라 작은 충격도 인플레이션 갭을 매기 키웁니다.${realReaction < 0 ? ` θπ = ${fmt(p.thPi, 1)}이면 물가가 1%p 오를 때 실질금리가 ${fmt(Math.abs(realReaction), 2)}%p 떨어져(테일러 원칙 위반) 수요와 물가가 더 오릅니다.` : ''}${where}`,
    })
  } else if (status === 'unit') {
    warnings.push({
      key: 'piLR',
      message: `실질금리가 물가에 반응하지 않아(λ + θπ = 0) 충격으로 벌어진 인플레이션 갭이 사라지지 않습니다. 물가상승률이 목표로 돌아오지 않습니다(장기 균형 없음).`,
    })
  } else if (status === 'parallel') {
    warnings.push({ key: 'piLR', message: 'DAD와 DAS가 평행해 교점(균형)이 없습니다. 계수를 조금 바꿔 보세요.' })
  }
  if (path.some((s) => s.i < 0) || (lr && lr.i < 0)) {
    warnings.push({ key: 'i1', message: '명목금리가 음수가 되는 기간이 있습니다. 이 선형 모형은 금리의 실효하한을 반영하지 않습니다.' })
  }

  // Sacrifice ratio: cumulative output loss (% of Ȳ) per pp of disinflation.
  const fall = start.pi - p.piStar
  const loss = path.slice(1).reduce((acc, s) => acc + ((p.Ybar - s.Y) / p.Ybar) * 100, 0)
  const sacrifice = Math.abs(fall) > 1e-9 && stopped === null ? loss / fall : Number.NaN

  const values: Values = {
    ...p,
    Mend: Number.NaN,
    ...suffixed(start, '0'),
    ...suffixed(s1, '1'),
    ...suffixed(lr, 'LR'),
    YT: path.length > ISMPPC_HORIZON ? path[ISMPPC_HORIZON].Y : Number.NaN,
    piT: path.length > ISMPPC_HORIZON ? path[ISMPPC_HORIZON].pi : Number.NaN,
    c,
    stability: STATUS_CODE[status],
    periods: path.length - 1,
    sacrifice,
  }

  const pts: Point[] = path.map((s) => ({ x: s.Y, y: s.pi }))
  const periodCurves = (s: PeriodState): Curve[] => {
    const sh = { eps: s.eps, e: s.e, nu: s.nu }
    const suffix = s.t === 1 ? '' : `(${s.t}기)`
    return [dadCurve(p, sh, xd, yd, 'DAD', `DAD${suffix}`), dasCurve(p, s.Eprev, s.nu, xd, yd, 'DAS', `DAS${suffix}`)]
  }
  const first: PeriodState = s1 ?? { ...start, t: 1, Eprev: start.Enext + p.expShock, ...shocksAt(p, 1) }
  const curves: Curve[] = [
    ...periodCurves(first),
    { id: 'LRAS', label: 'LRAS', tone: 'reference', points: [{ x: p.Ybar, y: yd[0] }, { x: p.Ybar, y: yd[1] }] },
  ]

  const e0 = pts[0]
  const e1 = pts[1] ?? e0
  const markers: Marker[] = [{ point: e0, label: 'E₀', kind: 'baseline' }]
  const near = (u: Point, v: Point) => Math.abs(u.x - v.x) < 1e-6 && Math.abs(u.y - v.y) < 1e-6
  if (!near(e1, e0)) markers.push({ point: e1, label: 'E₁', kind: 'short' })
  if (lr && !near({ x: lr.Y, y: lr.pi }, e0)) markers.push({ point: { x: lr.Y, y: lr.pi }, label: 'E*', kind: 'long' })

  const periods = Array.from({ length: ISMPPC_HORIZON + 1 }, (_, t) => String(t))
  const series = (key: (typeof KEYS)[number]) => periods.map((_, t) => (path[t] ? path[t][key] : Number.NaN))
  const timePaths: TimePath[] = [
    { key: 'Y', label: '산출 Y', digits: 2, kind: 'dynamic', periods, values: series('Y'), reference: { value: p.Ybar, label: 'Ȳ' } },
    { key: 'pi', label: '물가상승률 π', unit: '%', digits: 2, kind: 'dynamic', periods, values: series('pi'), reference: { value: p.piStar, label: 'π*' } },
    { key: 'i', label: '명목금리 i', unit: '%', digits: 2, kind: 'dynamic', periods, values: series('i'), reference: { value: p.piStar + p.rho, label: '정상상태' } },
    { key: 'r', label: '실질금리 r', unit: '%', digits: 2, kind: 'dynamic', periods, values: series('r'), reference: { value: p.rho, label: 'ρ' } },
  ]

  return {
    values,
    curves,
    equilibrium: { point: e1, label: 'E₁' },
    markers,
    trajectory: {
      points: pts,
      curves: path.map(periodCurves),
      fitUntil: status === 'stable' ? path.length - 1 : Math.min(DRIFT_FIT_PERIODS, path.length - 1),
      curvesFollowPeriod: true,
    },
    timePaths,
    stability: stabilityReadout(p, c, status),
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const EPS = 1e-9

function persistText(mode: number, n: number): string {
  return mode === 2 ? '영구적' : mode === 1 ? `1~${n}기 동안` : '1기에만'
}

/** How the real rate responds to inflation under the rule (sign of λ + θπ). */
function realRatePhrase(p: ISMPPCParams, up: boolean): string {
  const k = p.lambda + p.thPi
  if (k > EPS) return `테일러 준칙에 따라 명목금리가 물가상승률보다 더 크게 ${up ? '올라' : '내려'} 실질금리 ${up ? '상승' : '하락'} → 수요가 ${up ? '억제됨' : '살아남'}`
  if (k < -EPS) return `명목금리가 물가상승률보다 덜 ${up ? '올라' : '내려'} 실질금리가 오히려 ${up ? '하락' : '상승'}(테일러 원칙 위반) → 수요가 더 ${up ? '늘어남' : '줄어듦'}`
  return '실질금리가 물가에 반응하지 않음(λ + θπ = 0)'
}

function chains(p: ISMPPCParams, b: ISMPPCParams, start: { pi: number }): string[] {
  const out: string[] = []
  const anchorNote = p.lambda > 0 ? ` 기대가 목표에 일부 고정되어(λ = ${fmt(p.lambda, 2)}) 기대가 덜 따라 움직이므로 복귀가 더 빠릅니다.` : ''
  if (Math.abs(p.dG) > EPS) {
    const up = p.dG > 0
    out.push(
      `재정지출 ${up ? '증가' : '감소'}(ΔG = ${fmt(p.dG, 1)}%, ${persistText(p.gMode, p.gN)}) → IS 곡선의 수요 충격 ε ${up ? '증가' : '감소'} → DAD ${up ? '오른쪽' : '왼쪽'} 이동 → 1기: 산출·물가상승률 ${up ? '상승' : '하락'} → ${realRatePhrase(p, up)} → 이번 기 물가상승률이 기대에 반영되어 DAS가 ${up ? '위' : '아래'}로 이동 → 충격이 끝나면 DAD는 돌아오지만 기대가 천천히 돌아오므로 산출은 한동안 자연산출 ${up ? '아래' : '위'}에 머물며 물가상승률이 서서히 목표로 복귀.${anchorNote}`,
    )
  }
  if (Math.abs(p.eShock) > EPS) {
    const up = p.eShock > 0
    out.push(
      `준칙 이탈 ${up ? '긴축' : '완화'} 충격(e = ${fmt(p.eShock, 2)}%p, ${persistText(p.eMode, p.eN)}) → 같은 물가·산출에서 명목금리 ${up ? '인상' : '인하'} → 실질금리 ${up ? '상승' : '하락'} → 수요 ${up ? '감소' : '증가'}로 DAD ${up ? '왼쪽' : '오른쪽'} 이동 → 1기: 산출·물가상승률 ${up ? '하락' : '상승'} → 기대인플레이션이 ${up ? '낮아져' : '높아져'} DAS가 ${up ? '아래' : '위'}로 이동 → 충격이 사라진 뒤 정상상태로 서서히 복귀.${anchorNote}`,
    )
  }
  if (Math.abs(p.nu) > EPS) {
    const up = p.nu > 0
    out.push(
      up
        ? `비용 인상 충격(ν = ${fmt(p.nu, 2)}%p, ${persistText(p.nuMode, p.nuN)}) → DAS가 위로 이동 → 물가상승률 상승 → ${realRatePhrase(p, true)} → 산출 감소: 물가는 오르는데 산출은 줄어드는 스태그플레이션 → 높아진 물가상승률이 기대에 남아 DAS가 위에 머무름 → 산출이 자연산출보다 낮은 동안 물가상승률이 서서히 목표로 내려옴.${anchorNote}`
        : `비용 하락(유리한 공급) 충격(ν = ${fmt(p.nu, 2)}%p, ${persistText(p.nuMode, p.nuN)}) → DAS가 아래로 이동 → 물가상승률 하락 → ${realRatePhrase(p, false)} → 산출 증가 → 낮아진 기대가 서서히 목표로 돌아오며 복귀.${anchorNote}`,
    )
  }
  if (Math.abs(p.expShock) > EPS) {
    const up = p.expShock > 0
    out.push(
      `기대 충격: 1기 기대인플레이션이 ${fmt(Math.abs(p.expShock), 2)}%p ${up ? '높아짐' : '낮아짐'} → DAS가 ${up ? '위' : '아래'}로 이동 → 실제 물가상승률도 ${up ? '상승' : '하락'}(기대의 자기실현) → ${realRatePhrase(p, up)} → 산출 ${up ? '감소' : '증가'} → ${p.lambda < 1 ? '이번 기 물가가 다음 기 기대에 이어져 충격이 여러 기에 걸쳐 남음' : '기대가 목표에 완전히 고정되어(λ = 1) 다음 기에는 바로 목표로 복귀'}.`,
    )
  }
  if (Math.abs(p.piStar - start.pi) > EPS) {
    const down = p.piStar < start.pi
    out.push(
      down
        ? `디스인플레이션: 물가목표 인하(π* ${fmt(start.pi, 1)}% → ${fmt(p.piStar, 1)}%) → 1기 기대는 아직 옛 목표 ${fmt(start.pi, 1)}%(DAS 그대로) → 준칙이 새 목표 기준으로 금리를 올림 → 실질금리 상승으로 DAD가 아래로 이동 → 산출 감소·물가상승률 하락 → 기대가 따라 내려가며 DAS가 아래로 이동 → 물가상승률이 새 목표로 수렴하고 산출은 자연산출로 복귀.${p.lambda > 0 ? ` 새 목표가 기대에 바로 반영될수록(λ = ${fmt(p.lambda, 2)}) 고통이 줄어듭니다.` : ''}`
        : `물가목표 인상(π* ${fmt(start.pi, 1)}% → ${fmt(p.piStar, 1)}%) → 준칙이 새 목표 기준으로 금리를 낮춤 → 실질금리 하락으로 DAD가 위로 이동 → 산출 증가·물가상승률 상승 → 기대가 따라 오르며 DAS가 위로 이동 → 물가상승률이 새 목표로 수렴하고 산출은 자연산출로 복귀.`,
    )
  }
  if (Math.abs(p.thPi - b.thPi) > EPS || Math.abs(p.thY - b.thY) > EPS) {
    out.push(
      `준칙 계수 변경(θπ ${fmt(b.thPi, 1)} → ${fmt(p.thPi, 1)}, θY ${fmt(b.thY, 1)} → ${fmt(p.thY, 1)}): θπ가 클수록 DAD가 완만해져 공급 충격에는 물가가 덜, 산출이 더 움직이고 조정이 빨라집니다. θY가 클수록 DAD가 가팔라져 산출 변동이 줄어듭니다.${p.lambda + p.thPi < 0 ? ' θπ가 −λ보다 작으면 DAD가 우상향이 되어 테일러 원칙이 깨집니다.' : ''}`,
    )
  }
  if (Math.abs(p.lambda - b.lambda) > EPS) {
    out.push(`기대 고정 정도 λ ${fmt(b.lambda, 2)} → ${fmt(p.lambda, 2)}: λ가 ${p.lambda > b.lambda ? '클수록 기대가 목표에 묶여 충격이 덜 지속됩니다' : '작을수록 기대가 지난 물가를 따라가 충격이 오래 지속됩니다'}.`)
  }
  const pnames: [keyof ISMPPCParams, string][] = [['alpha', 'α'], ['phi', 'φ'], ['rho', 'ρ'], ['Ybar', 'Ȳ']]
  for (const [k, sym] of pnames) {
    if (Math.abs(p[k] - b[k]) <= EPS) continue
    const up = p[k] > b[k]
    const text: Record<string, string> = {
      alpha: `수요의 금리 민감도 α ${up ? '상승' : '하락'} → 같은 실질금리 변화에 산출이 ${up ? '더' : '덜'} 반응 → DAD가 ${up ? '완만' : '가파르게'}해지고 통화정책의 전달력이 ${up ? '강해짐' : '약해짐'}`,
      phi: `필립스 곡선 기울기 φ ${up ? '상승' : '하락'} → DAS가 ${up ? '가팔라짐' : '완만해짐'} → 산출 갭이 물가상승률을 ${up ? '더 빨리' : '더 천천히'} 움직여 조정 속도가 ${up ? '빨라짐' : '느려짐'}`,
      rho: `자연이자율 ρ ${up ? '상승' : '하락'} → IS와 준칙이 같은 ρ를 쓰므로 산출·물가상승률은 그대로이고 명목·실질금리만 ${fmt(p.rho - b.rho, 2)}%p 바뀜`,
      Ybar: `자연산출 ${up ? '증가' : '감소'} → LRAS ${up ? '오른쪽' : '왼쪽'} 이동 → 1기에 산출이 새 자연산출로 옮겨 감(기대가 목표에 맞아 있어 물가는 그대로)`,
    }
    out.push(`${text[k]}. (${sym}: ${fmt(b[k], 2)} → ${fmt(p[k], 2)})`)
  }
  return out
}

function explain(
  baseline: { input: ScenarioInput; solution: Solution },
  current: { input: ScenarioInput; solution: Solution },
): string[] {
  const p = toISMPPCParams(current.input.values)
  const b = toISMPPCParams(baseline.input.values)
  const v = current.solution.values
  const start = { pi: v.pi0 }
  const out = chains(p, b, start)
  const moved = [...KEYS].some((k) => {
    const ys = current.solution.timePaths?.find((t) => t.key === k)?.values ?? []
    return ys.some((y, t) => t > 0 && (!Number.isFinite(y) || Math.abs(y - ys[0]) > 1e-9))
  })
  if (out.length === 0 && !moved) {
    return ['경제가 정상상태(Y = Ȳ, π = π*, r = ρ)에 있습니다. 재정지출·준칙 이탈·기대·공급 충격을 주거나 준칙 계수와 물가목표를 바꾸면, 1기에 무엇이 일어나고 이후 어떻게 조정되는지 여기에 설명이 나타납니다.']
  }
  if (!moved) return out

  const imp = `1기(충격 직후): 산출 Y ${fmt(v.Y0, 2)} → ${fmt(v.Y1, 2)}, 물가상승률 π ${fmt(v.pi0, 2)}% → ${fmt(v.pi1, 2)}%, 명목금리 i ${fmt(v.i0, 2)}% → ${fmt(v.i1, 2)}%, 실질금리 r ${fmt(v.r0, 2)}% → ${fmt(v.r1, 2)}%.`
  out.push(imp)
  const stable = v.stability === 1
  if (stable && Number.isFinite(v.YLR)) {
    const pis = current.solution.timePaths?.find((t) => t.key === 'pi')?.values ?? []
    let at: number | null = null
    for (let t = pis.length - 1; t >= 1; t--) {
      if (Math.abs(pis[t] - v.piLR) < 0.01) at = t
      else break
    }
    out.push(
      `장기: 산출 ${fmt(v.YLR, 2)}, 물가상승률 ${fmt(v.piLR, 2)}%, 명목금리 ${fmt(v.iLR, 2)}%, 실질금리 ${fmt(v.rLR, 2)}%.${at !== null && at > 1 ? ` 물가상승률은 ${at}기부터 장기값과의 차이가 0.01%p 미만입니다.` : ''} 인플레이션 갭은 매기 c = ${fmt(v.c, 3)}배로 줄어듭니다${p.lambda === 0 ? '(적응적 기대)' : ''}.`,
    )
    if (Math.abs(v.piLR - p.piStar) > 1e-6) {
      out.push(
        `영구적 충격이 있어 장기 물가상승률이 목표 π* = ${fmt(p.piStar, 1)}%와 ${fmt(v.piLR - p.piStar, 2)}%p 다릅니다. 준칙이 바뀐 상황(예: 수요 충격으로 달라진 중립금리)을 반영하지 않기 때문입니다.${Math.abs(v.YLR - p.Ybar) > 1e-6 ? ' λ > 0이면 기대가 목표에 묶여 있어 장기에도 산출 갭이 남는데, 이는 이 단순 모형의 한계입니다.' : ''}`,
      )
    }
  } else if (v.stability === -1) {
    out.push(`이 계수에서는 경로가 발산합니다(|c| = ${fmt(Math.abs(v.c), 3)} > 1). 물가상승률이 목표에서 점점 멀어지므로 장기 균형이 없습니다.`)
  }
  const onlyTarget = Math.abs(p.piStar - start.pi) > EPS && [p.dG, p.eShock, p.nu, p.expShock].every((x) => Math.abs(x) <= EPS)
  if (onlyTarget && Number.isFinite(v.sacrifice) && stable) {
    out.push(
      `희생률: 물가상승률을 ${fmt(Math.abs(start.pi - p.piStar), 1)}%p ${p.piStar < start.pi ? '낮추는' : '높이는'} 동안 누적 산출 ${p.piStar < start.pi ? '손실' : '이득'}이 자연산출의 ${fmt(Math.abs(v.sacrifice * (start.pi - p.piStar)), 2)}%로, 1%p당 ${fmt(Math.abs(v.sacrifice), 2)}%입니다. 기대가 새 목표에 빨리 고정될수록(λ↑) 희생률이 작아집니다.`,
    )
  }
  return out
}

export const ismppcModel: ModelDefinition = {
  id: 'ismppc',
  name: 'IS-MP-PC',
  variables: VARIABLES,
  regimes: [{ id: 'taylor', label: '테일러 준칙', description: '중앙은행이 매기 물가상승률과 산출 갭에 반응해 명목금리를 정합니다(통화량은 결과값). 한 기간은 1년입니다.' }],
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
    { label: 'IS (재화시장, ε: 수요 충격)', latex: 'Y_t = \\bar Y - \\alpha\\,(r_t - \\rho) + \\varepsilon_t' },
    { label: '피셔 방정식', latex: 'r_t = i_t - E_t\\pi_{t+1}' },
    { label: '필립스 곡선 PC (ν: 공급 충격)', latex: '\\pi_t = E_{t-1}\\pi_t + \\phi\\,(Y_t - \\bar Y) + \\nu_t' },
    { label: '기대 형성 (λ = 0: 적응적, λ = 1: 완전 고정)', latex: 'E_t\\pi_{t+1} = \\lambda\\,\\pi^* + (1-\\lambda)\\,\\pi_t' },
    { label: '통화정책 준칙 MP (e: 준칙 이탈 충격)', latex: 'i_t = \\pi_t + \\rho + \\theta_\\pi(\\pi_t - \\pi^*) + \\theta_Y(Y_t - \\bar Y) + e_t' },
    { label: '동태적 총수요 DAD (IS + MP + 피셔)', latex: 'Y_t - \\bar Y = \\dfrac{\\varepsilon_t - \\alpha e_t - \\alpha(\\lambda+\\theta_\\pi)(\\pi_t - \\pi^*)}{1+\\alpha\\theta_Y}' },
    { label: '해 (1기씩 차례로 풂, A = α(λ+θπ)/(1+αθY))', latex: '\\pi_t - \\pi^* = \\dfrac{E_{t-1}\\pi_t - \\pi^* + \\nu_t + \\phi\\,\\frac{\\varepsilon_t - \\alpha e_t}{1+\\alpha\\theta_Y}}{1 + \\phi A}' },
  ],
  glossary: [
    { term: '필립스 곡선', text: '산출이 자연산출보다 높을수록(실업이 낮을수록) 물가상승률이 기대보다 높아진다는 관계. 이 모형의 동태적 총공급(DAS)입니다.' },
    { term: '테일러 준칙', text: '중앙은행이 물가상승률과 산출 갭에 반응해 명목금리를 정하는 규칙. 이 모형에서 통화량은 그 금리에 맞춰 결과로 정해집니다.' },
    { term: '테일러 원칙', text: '물가상승률이 1%p 오르면 명목금리를 1%p보다 더 올려 실질금리를 높여야 한다는 원칙(θπ > 0). 어기면 인플레이션이 스스로 커집니다.' },
    { term: '자연이자율', text: '산출을 자연산출 수준에 머물게 하는 실질금리 ρ. 실질금리가 이보다 높으면 수요가 줄고, 낮으면 늘어납니다.' },
    { term: '적응적 기대', text: '다음 해 물가상승률을 올해 물가상승률로 예상하는 방식(λ = 0). 기대가 늦게 따라오므로 충격이 오래 지속됩니다.' },
    { term: '기대 고정(앵커링)', text: '사람들이 중앙은행의 목표 π*를 믿어 기대인플레이션이 목표 근처에 머무는 상태(λ > 0). 고정될수록 충격이 빨리 사라집니다.' },
    { term: '희생률', text: '물가상승률을 1%p 낮추기 위해 감수해야 하는 누적 산출 손실(자연산출 대비 %).' },
  ],
  timePathNote: `한 기간은 1년입니다. 충격과 바뀐 정책은 1기에 시작되고 ${ISMPPC_HORIZON}기까지 계산합니다. 0기는 기준점의 정상상태(충격 없음)입니다. 아래 기간 슬라이더로 특정 연도의 DAD·DAS를 그래프에서 볼 수 있습니다.`,
  lockedVariables: () => LOCKS,
  solve,
  explain,
}
