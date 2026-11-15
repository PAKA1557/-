/**
 * AD-AS: the IS-LM goods and money markets with an endogenous price level,
 * a short-run aggregate supply curve and adaptive expectations.
 *
 *   AD (money target):  Y = α + β / P, the IS-LM equilibrium at price level P,
 *                       α = (c0 − c1T + b0 + G + b1πe) / (1 − c1 + b1k/h),
 *                       β = (b1/h) M / (1 − c1 + b1k/h)
 *   AD (rate target):   Y = (c0 − c1T + b0 + G − b1(i − πe)) / (1 − c1)   (vertical)
 *   SRAS:               P_t = Pe_t + (Y_t − Ȳ) / a
 *   Expectations:       Pe_{t+1} = P_t
 *   LRAS:               Y = Ȳ
 *
 * Period 0 is the baseline's equilibrium (its long-run equilibrium when one
 * exists); the current policy applies from period 1 to ADAS_HORIZON.
 * AD ∩ SRAS is solved exactly: with a money target it is the quadratic
 *   a P² + (Ȳ − a Pe − α) P − β = 0,
 * whose positive root is unique because β > 0.
 */
import {
  autonomous,
  fiscalMultiplierMoney,
  fmt,
  ISLM_DEFAULTS,
  solveMoneyTarget,
  solveRateTarget,
  type ISLMParams,
} from './islm'
import type {
  Curve,
  LockInfo,
  Marker,
  ModelDefinition,
  Point,
  ScenarioInput,
  Solution,
  SolveOptions,
  TimePath,
  Values,
  VariableSpec,
  Warning,
} from './types'
import { linspace } from './view'

export type ADASRegime = 'money' | 'rate'

/** Number of periods simulated after the shock (t = 0 … ADAS_HORIZON). */
export const ADAS_HORIZON = 40

export interface ADASParams extends Omit<ISLMParams, 'P'> {
  /** SRAS slope parameter: P = Pe + (Y − Ȳ)/a. */
  a: number
  /** Natural output Ȳ. */
  Yn: number
}

const D = ISLM_DEFAULTS
export const ADAS_DEFAULTS: ADASParams = {
  c0: D.c0, c1: D.c1, T: D.T, b0: D.b0, b1: D.b1, G: D.G, M: D.M, k: D.k, h: D.h, pe: D.pe, i: D.i,
  a: 100,
  Yn: 1100,
}

/**
 * Price level used to start period 0 when the baseline has no money-target
 * long-run equilibrium (P_LR does not exist). Equals the default P_LR.
 */
export const ADAS_FALLBACK_P = 2

export interface PeriodState {
  t: number
  /** Expected price level carried into the period. */
  Pe: number
  P: number
  Y: number
  i: number
  r: number
  C: number
  I: number
  M: number
}

/** Long-run equilibrium: Y = Ȳ on both AD and LRAS. */
export interface LongRun {
  Y: number
  P: number
  i: number
  r: number
  C: number
  I: number
  M: number
}

const asISLM = (p: ADASParams, P: number): ISLMParams => ({ ...p, P })

/** Money-target AD in the form Y = α + β / P. */
export function adCoefficients(p: ADASParams): { alpha: number; beta: number } {
  const q = asISLM(p, 1)
  const mult = fiscalMultiplierMoney(q)
  return { alpha: (autonomous(q) + p.b1 * p.pe) * mult, beta: (p.b1 / p.h) * p.M * mult }
}

/** Rate-target AD: output does not depend on P (vertical AD). */
export function verticalAD(p: ADASParams): number {
  return (autonomous(asISLM(p, 1)) - p.b1 * (p.i - p.pe)) / (1 - p.c1)
}

/** Output demanded at price level P. */
export function yAD(p: ADASParams, regime: ADASRegime, P: number): number {
  if (regime === 'rate') return verticalAD(p)
  const { alpha, beta } = adCoefficients(p)
  return alpha + beta / P
}

/** Short-run aggregate supply: P = Pe + (Y − Ȳ)/a. */
export function priceSRAS(p: ADASParams, Pe: number, Y: number): number {
  return Pe + (Y - p.Yn) / p.a
}

/**
 * Exact positive root of a P² + B P − β = 0 with B = Ȳ − a Pe − α.
 * Uses the cancellation-free form of the quadratic formula.
 */
export function solvePrice(p: ADASParams, Pe: number): number {
  const { alpha, beta } = adCoefficients(p)
  const B = p.Yn - p.a * Pe - alpha
  if (beta > 0) {
    const s = Math.sqrt(B * B + 4 * p.a * beta)
    return B >= 0 ? (2 * beta) / (B + s) : (s - B) / (2 * p.a)
  }
  // β ≤ 0 only when M ≤ 0, which the sliders do not allow.
  return beta === 0 && B < 0 ? -B / p.a : Number.NaN
}

function stateAt(p: ADASParams, regime: ADASRegime, t: number, Pe: number, P: number): PeriodState {
  const res = regime === 'rate' ? solveRateTarget(asISLM(p, P)) : solveMoneyTarget(asISLM(p, P))
  return { t, Pe, P, Y: res.Y, i: res.i, r: res.r, C: res.C, I: res.I, M: res.M }
}

/** AD ∩ SRAS for a period with expected price level Pe. */
export function solvePeriod(p: ADASParams, regime: ADASRegime, Pe: number, t = 0): PeriodState {
  const P = regime === 'rate' ? priceSRAS(p, Pe, verticalAD(p)) : solvePrice(p, Pe)
  return stateAt(p, regime, t, Pe, P)
}

/** Money-target long-run price level: Ȳ = α + β / P. Null when AD never reaches down to Ȳ. */
export function longRunPrice(p: ADASParams): number | null {
  const { alpha, beta } = adCoefficients(p)
  const gap = p.Yn - alpha
  if (!(gap > 0) || !(beta > 0)) return null
  return beta / gap
}

/** Tolerance below which the rate-target AD counts as sitting on LRAS. */
const DRIFT_EPS = 1e-9

/** Per-period price drift under a rate peg: (Y_AD − Ȳ)/a. */
export function rateDrift(p: ADASParams): number {
  const d = (verticalAD(p) - p.Yn) / p.a
  return Math.abs(d) < DRIFT_EPS ? 0 : d
}

/**
 * Long-run equilibrium. Money target: P_LR from Ȳ = α + β/P.
 * Rate target: exists only when the vertical AD sits on LRAS, and then the
 * price level is whatever it was (`Pstart`) — nothing pins it down.
 */
export function longRun(p: ADASParams, regime: ADASRegime, Pstart: number): LongRun | null {
  if (regime === 'rate') {
    if (rateDrift(p) !== 0) return null
    const s = stateAt(p, 'rate', 0, Pstart, Pstart)
    return { Y: s.Y, P: s.P, i: s.i, r: s.r, C: s.C, I: s.I, M: s.M }
  }
  const P = longRunPrice(p)
  if (P === null) return null
  const s = stateAt(p, 'money', 0, P, P)
  return { Y: s.Y, P: s.P, i: s.i, r: s.r, C: s.C, I: s.I, M: s.M }
}

/** Price level the baseline starts from: its money-target P_LR (using its M), else the fallback. */
export function anchorPrice(p: ADASParams): number {
  return longRunPrice(p) ?? ADAS_FALLBACK_P
}

/** Period 0: the baseline's equilibrium given Pe = anchor price. */
export function initialState(p: ADASParams, regime: ADASRegime): PeriodState {
  return solvePeriod(p, regime, anchorPrice(p), 0)
}

export interface Simulation {
  /** Periods 0 … n (n = horizon unless the price level stopped being positive). */
  path: PeriodState[]
  /** True when the path was cut short because P_t ≤ 0. */
  truncated: boolean
}

/** Run periods 1 … horizon under `p` starting from the period-0 state. */
export function simulate(start: PeriodState, p: ADASParams, regime: ADASRegime, horizon = ADAS_HORIZON): Simulation {
  const path: PeriodState[] = [start]
  for (let t = 1; t <= horizon; t++) {
    const s = solvePeriod(p, regime, path[t - 1].P, t)
    if (!(s.P > 0) || !Number.isFinite(s.Y)) return { path, truncated: true }
    path.push(s)
  }
  return { path, truncated: false }
}

/** Convenience for tests: baseline (period 0) → current policy (periods 1…). */
export function simulateShock(
  base: ADASParams,
  baseRegime: ADASRegime,
  cur: ADASParams,
  curRegime: ADASRegime,
  horizon = ADAS_HORIZON,
): Simulation {
  return simulate(initialState(base, baseRegime), cur, curRegime, horizon)
}

// ---------------------------------------------------------------------------
// Model definition
// ---------------------------------------------------------------------------

const VARIABLES: VariableSpec[] = [
  { key: 'G', label: '재정지출', symbol: 'G', min: 0, max: 300, step: 5, default: 100, group: 'policy', digits: 0, description: '정부지출. 늘리면 각 물가수준에서 총수요가 늘어 AD 곡선이 오른쪽으로 이동합니다.' },
  { key: 'M', label: '통화량', symbol: 'M', min: 600, max: 1400, step: 10, default: 1000, group: 'policy', digits: 0, description: '명목 통화공급. 늘리면 각 물가에서 실질통화량 M/P가 늘어 AD가 오른쪽으로 이동합니다.' },
  { key: 'i', label: '기준금리', symbol: 'i', unit: '%', min: 0, max: 12, step: 0.25, default: 6, group: 'policy', digits: 2, description: '중앙은행이 고정하는 명목금리. 금리 목표제에서 AD는 이 금리에서 수직이 됩니다.' },
  { key: 'pe', label: '기대인플레이션', symbol: 'πe', unit: '%', min: -2, max: 5, step: 0.5, default: 0, group: 'policy', digits: 1, description: '투자가 반응하는 실질금리 r = i − πe에 들어가는 예상 물가상승률(외생). 기대 물가수준 Pe와는 별개입니다.' },
  { key: 'a', label: 'AS 기울기 파라미터', symbol: 'a', min: 20, max: 400, step: 10, default: 100, group: 'param', digits: 0, description: 'SRAS P = Pe + (Y − Ȳ)/a의 기울기는 1/a. 클수록 SRAS가 평평해 단기에 산출은 크게, 물가는 적게 반응하고 조정이 느려집니다.' },
  { key: 'Yn', label: '자연산출', symbol: 'Ȳ', min: 900, max: 1300, step: 10, default: 1100, group: 'param', digits: 0, description: '기대가 실현될 때의 산출(LRAS의 위치). 장기에는 산출이 이 값으로 돌아옵니다.' },
  { key: 'c1', label: '한계소비성향', symbol: 'c1', min: 0.5, max: 0.9, step: 0.01, default: 0.75, group: 'param', digits: 2, description: '가처분소득이 1 늘 때 소비가 늘어나는 비율.' },
  { key: 'b1', label: '투자의 금리 민감도', symbol: 'b1', min: 5, max: 50, step: 1, default: 25, group: 'param', digits: 0, description: '실질금리 1%p 상승 시 줄어드는 투자액.' },
  { key: 'k', label: '화폐수요의 소득 민감도', symbol: 'k', min: 0.5, max: 1.5, step: 0.05, default: 1, group: 'param', digits: 2, description: '소득이 1 늘 때 늘어나는 실질화폐수요.' },
  { key: 'h', label: '화폐수요의 금리 민감도', symbol: 'h', min: 50, max: 200, step: 5, default: 100, group: 'param', digits: 0, description: '금리 1%p 상승 시 줄어드는 실질화폐수요.' },
  { key: 'T', label: '조세', symbol: 'T', min: 0, max: 300, step: 5, default: 100, group: 'param', digits: 0, description: '정액세. 늘리면 소비가 줄어 AD가 왼쪽으로 이동합니다.' },
]

const LOCKS: Record<ADASRegime, LockInfo[]> = {
  money: [
    { key: 'i', resultKey: 'i1', reason: '통화량 목표제에서는 중앙은행이 M을 정하고, 금리는 화폐시장 균형에서 결정됩니다(표시값: 충격 직후 1기의 금리).' },
  ],
  rate: [
    { key: 'M', resultKey: 'M1', reason: '금리 목표제에서는 중앙은행이 i를 고정하고, 그 금리를 유지하는 데 필요한 통화량이 결과로 정해집니다(표시값: 1기의 통화량).' },
  ],
}

function toRegime(id: string): ADASRegime {
  return id === 'rate' ? 'rate' : 'money'
}

export function toADASParams(values: Values): ADASParams {
  const p = { ...ADAS_DEFAULTS }
  for (const key of Object.keys(p) as (keyof ADASParams)[]) {
    const v = values[key]
    if (typeof v === 'number' && Number.isFinite(v)) p[key] = v
  }
  return p
}

const DEFAULT_X: [number, number] = [800, 1400]
const DEFAULT_Y: [number, number] = [0, 4]
/** Graph ranges follow at most this many periods of an unanchored (drifting) path. */
const DRIFT_FIT_PERIODS = 8

function adCurve(p: ADASParams, regime: ADASRegime, xd: [number, number], yd: [number, number]): Curve {
  if (regime === 'rate') {
    const Y = verticalAD(p)
    return { id: 'AD', label: 'AD', tone: 'primary', points: [{ x: Y, y: yd[0] }, { x: Y, y: yd[1] }] }
  }
  const { alpha, beta } = adCoefficients(p)
  const span = yd[1] - yd[0]
  const lo = Math.max(yd[0], yd[1] / 400, 1e-6)
  const hi = yd[1] + span * 0.05
  const xMax = xd[1] + (xd[1] - xd[0])
  const points = linspace(lo, hi, 161)
    .map((P) => ({ x: alpha + beta / P, y: P }))
    .filter((pt) => pt.x <= xMax)
    .sort((u, v) => u.x - v.x)
  return { id: 'AD', label: 'AD', tone: 'primary', points }
}

function srasCurve(p: ADASParams, Pe: number, xd: [number, number], id: string, label: string): Curve {
  return {
    id,
    label,
    tone: 'secondary',
    points: [xd[0], xd[1]].map((Y) => ({ x: Y, y: priceSRAS(p, Pe, Y) })),
  }
}

const KEYS = ['Y', 'P', 'i', 'r', 'C', 'I', 'M'] as const

function suffixed(s: PeriodState | LongRun | null, suffix: string): Values {
  return Object.fromEntries(KEYS.map((k) => [k + suffix, s ? s[k] : Number.NaN]))
}

function solve(input: ScenarioInput, options: SolveOptions = {}): Solution {
  const regime = toRegime(input.regime)
  const p = toADASParams(input.values)
  const xd = options.xDomain ?? DEFAULT_X
  const yd = options.yDomain ?? DEFAULT_Y

  // Period 0 comes from the baseline when one is given; otherwise the input is its own baseline.
  const bv = options.baseline?.values
  const start: PeriodState =
    bv && KEYS.every((k) => Number.isFinite(bv[`${k}0`])) && Number.isFinite(bv.Pe0)
      ? { t: 0, Pe: bv.Pe0, P: bv.P0, Y: bv.Y0, i: bv.i0, r: bv.r0, C: bv.C0, I: bv.I0, M: bv.M0 }
      : initialState(p, regime)
  const baseYn = bv && Number.isFinite(bv.Yn) ? bv.Yn : p.Yn
  const { path, truncated } = simulate(start, p, regime)
  const s1 = path[1] ?? null
  const lr = longRun(p, regime, start.P)
  const drift = regime === 'rate' ? rateDrift(p) : 0

  const warnings: Warning[] = []
  if (regime === 'rate' && drift !== 0) {
    warnings.push({
      key: 'P',
      message: `금리를 ${fmt(p.i, 2)}%에 고정하면 수직 AD가 Y = ${fmt(verticalAD(p), 0)}에 놓여 자연산출 Ȳ = ${fmt(p.Yn, 0)}${drift > 0 ? '을 웃돌고' : '에 못 미치고'}, 물가가 매기 ${fmt(Math.abs(drift), 3)}씩 끝없이 ${drift > 0 ? '오릅니다' : '내립니다'}. 기대 물가가 따라 움직여도 고정된 금리 때문에 AD가 물가에 반응하지 않으므로, 이 모형에서 금리 고정은 물가수준을 붙잡아 둘 닻(명목 기준점)이 없습니다. 다음 단계(IS-MP-PC)의 테일러 준칙처럼 금리가 물가·산출에 반응해야 물가가 안정됩니다.`,
    })
  }
  if (regime === 'money' && lr === null) {
    warnings.push({
      key: 'P',
      message: `물가가 아무리 높아도 총수요가 자연산출 Ȳ = ${fmt(p.Yn, 0)}보다 커서(AD의 점근선 Y = ${fmt(adCoefficients(p).alpha, 0)}) 장기 균형 물가가 존재하지 않습니다. 물가가 매기 오르기만 합니다. 재정지출이나 기대인플레이션을 낮추거나 자연산출을 높여 보세요.`,
    })
  }
  if (truncated) {
    warnings.push({
      key: 'P',
      message: `${path.length}기에 물가가 0 이하로 떨어져 그 이후는 계산하지 않았습니다. 선형 SRAS를 지나치게 멀리 적용한 결과입니다.`,
    })
  }
  if (Math.abs(start.Y - baseYn) > 1e-6) {
    warnings.push({
      message: `기준점(0기)이 장기 균형이 아닙니다(산출 ≠ 자연산출). 0기 값은 기준점 정책에서 기대 물가가 Pe = ${fmt(start.Pe, 3)}일 때의 균형입니다.`,
    })
  }
  if (path.some((s) => s.i < 0) || (lr && lr.i < 0)) {
    warnings.push({ key: 'i', message: '명목금리가 음수가 되는 기간이 있습니다. 이 선형 모형은 실효하한을 반영하지 않습니다.' })
  }
  if (regime === 'rate' && path.some((s) => s.M <= 0)) {
    warnings.push({ key: 'M', message: '이 금리를 유지하는 데 필요한 통화량이 0 이하가 되는 기간이 있습니다. 모형상 실현될 수 없는 조합입니다.' })
  }
  if (path.some((s) => s.I < 0) || (lr && lr.I < 0)) {
    warnings.push({ key: 'I', message: '투자가 음수가 되는 기간이 있습니다. 선형 모형을 지나치게 멀리 적용한 결과로, 현실적인 해석은 어렵습니다.' })
  }

  const values: Values = {
    ...p,
    ...suffixed(start, '0'),
    Pe0: start.Pe,
    ...suffixed(s1, '1'),
    ...suffixed(lr, 'LR'),
    drift,
    YT: path.length > ADAS_HORIZON ? path[ADAS_HORIZON].Y : Number.NaN,
    PT: path.length > ADAS_HORIZON ? path[ADAS_HORIZON].P : Number.NaN,
  }

  const pts: Point[] = path.map((s) => ({ x: s.Y, y: s.P }))
  const curves: Curve[] = [
    adCurve(p, regime, xd, yd),
    srasCurve(p, s1 ? s1.Pe : start.P, xd, 'SRAS', 'SRAS'),
    { id: 'LRAS', label: 'LRAS', tone: 'reference', points: [{ x: p.Yn, y: yd[0] }, { x: p.Yn, y: yd[1] }] },
  ]

  const e0 = pts[0]
  const e1 = pts[1] ?? e0
  const markers: Marker[] = [{ point: e0, label: 'E₀', kind: 'baseline' }]
  const near = (u: Point, v: Point) => Math.abs(u.x - v.x) < 1e-6 && Math.abs(u.y - v.y) < 1e-9
  if (!near(e1, e0)) markers.push({ point: e1, label: 'E₁', kind: 'short' })
  if (lr && !near({ x: lr.Y, y: lr.P }, e0)) markers.push({ point: { x: lr.Y, y: lr.P }, label: 'E*', kind: 'long' })

  const periods = Array.from({ length: ADAS_HORIZON + 1 }, (_, t) => String(t))
  const series = (key: (typeof KEYS)[number]) => periods.map((_, t) => (path[t] ? path[t][key] : Number.NaN))
  const timePaths: TimePath[] = [
    { key: 'Y', label: '산출 Y', digits: 0, kind: 'dynamic', periods, values: series('Y'), reference: { value: p.Yn, label: 'Ȳ' } },
    { key: 'P', label: '물가 P', digits: 3, kind: 'dynamic', periods, values: series('P'), ...(lr ? { reference: { value: lr.P, label: '장기' } } : {}) },
    { key: 'i', label: '금리 i', unit: '%', digits: 2, kind: 'dynamic', periods, values: series('i') },
    { key: 'I', label: '투자 I', digits: 0, kind: 'dynamic', periods, values: series('I') },
  ]

  return {
    values,
    curves,
    equilibrium: { point: e1, label: 'E₁' },
    markers,
    trajectory: {
      points: pts,
      curves: path.map((s) => [srasCurve(p, s.Pe, xd, `SRAS${s.t}`, `SRAS(${s.t}기)`)]),
      fitUntil: lr ? ADAS_HORIZON : DRIFT_FIT_PERIODS,
    },
    timePaths,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const EPS = 1e-9

function signed(n: number, digits: number): string {
  const s = fmt(n, digits)
  if (s === fmt(0, digits)) return '변화 없음'
  return n > 0 ? `+${s}` : s.replace('-', '−')
}

function chain(key: string, up: boolean, regime: ADASRegime): string | null {
  const inc = up ? '증가' : '감소'
  const rise = up ? '상승' : '하락'
  const right = up ? '오른쪽' : '왼쪽'
  const sras = up ? '위' : '아래'
  const money = regime === 'money'
  const drift = `→ 금리가 고정되어 AD(수직)가 물가에 반응하지 않으므로 산출이 자연산출로 돌아오지 않음 → 기대 물가가 따라 ${rise}하며 SRAS가 매기 ${sras}로 이동 → 물가가 끝없이 ${rise}(물가의 닻이 없음)`
  switch (key) {
    case 'M':
      return money
        ? `통화량 ${inc} → 각 물가에서 실질통화량 M/P ${inc} → 금리 ${up ? '하락' : '상승'}·투자 ${inc} → AD ${right} 이동 → 단기: 산출·물가 ${rise} → 기대 물가 ${up ? '상향' : '하향'} 조정으로 SRAS ${sras}로 이동 → 장기: 산출은 자연산출로 복귀, 물가만 통화량과 같은 비율로 ${rise}(화폐 중립성)`
        : null
    case 'G':
      return money
        ? `재정지출 ${inc} → AD ${right} 이동 → 단기: 산출·물가·금리 ${rise} → 기대 물가 ${up ? '상향' : '하향'} 조정으로 SRAS ${sras}로 이동 → 물가 ${rise}으로 실질통화량이 ${up ? '줄어' : '늘어'} 금리가 더 ${rise} → 장기: 산출은 자연산출로 복귀, 물가와 금리는 ${up ? '더 높고' : '더 낮고'} 투자는 재정지출 변화만큼 ${up ? '감소(완전 구축)' : '증가'}`
        : `재정지출 ${inc} → 금리 고정으로 구축효과 없이 수직 AD가 ${right}으로 이동 → 산출이 자연산출${up ? '을 웃돎' : '에 못 미침'} ${drift}`
    case 'T':
      return money
        ? `조세 ${inc} → 소비 ${up ? '감소' : '증가'} → AD ${up ? '왼쪽' : '오른쪽'} 이동 → 단기: 산출·물가 ${up ? '하락' : '상승'} → 기대 물가 조정으로 SRAS ${up ? '아래' : '위'}로 이동 → 장기: 산출은 자연산출로 복귀, 물가와 금리 ${up ? '하락' : '상승'}, 투자 ${up ? '증가' : '감소'}`
        : `조세 ${inc} → 소비 ${up ? '감소' : '증가'} → 수직 AD가 ${up ? '왼쪽' : '오른쪽'}으로 이동 → 금리가 고정되어 산출이 자연산출에서 벗어난 채 유지 → 물가가 매기 같은 폭으로 계속 ${up ? '하락' : '상승'}(물가의 닻이 없음)`
    case 'i':
      return money
        ? null
        : `기준금리 ${up ? '인상' : '인하'} → 실질금리 ${rise} → 투자 ${up ? '감소' : '증가'} → 수직 AD가 ${up ? '왼쪽' : '오른쪽'}으로 이동 → 산출이 자연산출${up ? '에 못 미침' : '을 웃돎'} → 기대 물가가 따라 ${up ? '하락' : '상승'}하며 SRAS가 매기 ${up ? '아래' : '위'}로 이동 → 금리가 고정되어 있어 물가가 끝없이 ${up ? '하락' : '상승'}(물가의 닻이 없음)`
    case 'pe':
      return money
        ? `기대인플레이션 ${rise} → 같은 명목금리에서 실질금리 ${up ? '하락' : '상승'} → 투자 ${inc} → AD ${right} 이동 → 단기: 산출·물가 ${rise} → SRAS가 기대 물가를 따라 ${sras}로 이동 → 장기: 산출은 자연산출로 복귀, 물가 ${rise}`
        : `기대인플레이션 ${rise} → 명목금리가 고정되어 실질금리 ${up ? '하락' : '상승'} → 투자 ${inc} → 수직 AD가 ${right}으로 이동 ${drift}`
    case 'a':
      return `AS 기울기 파라미터 a ${up ? '상승' : '하락'} → SRAS 기울기 1/a가 ${up ? '작아져 평평해짐' : '커져 가팔라짐'} → 충격에 대한 단기 산출 반응이 ${up ? '커지고' : '작아지고'} 물가 반응은 ${up ? '작아짐' : '커짐'}, 조정은 ${up ? '느려짐' : '빨라짐'} → 장기 균형(LRAS 위의 점)은 a와 무관`
    case 'Yn':
      return `자연산출 ${inc} → LRAS ${right} 이동, 같은 기대 물가에서 SRAS도 ${right}(${up ? '아래' : '위'})로 이동 → 단기: 산출 ${inc}, 물가 ${up ? '하락' : '상승'} → 장기: 산출은 새 자연산출, 물가는 ${up ? '더 낮은' : '더 높은'} 수준`
    case 'c1':
    case 'b1':
    case 'k':
    case 'h':
      return `${key === 'c1' ? '한계소비성향' : key === 'b1' ? '투자의 금리 민감도' : key === 'k' ? '화폐수요의 소득 민감도' : '화폐수요의 금리 민감도'} ${up ? '상승' : '하락'} → IS·LM이 바뀌어 AD의 위치와 기울기가 달라짐 → 단기 균형이 SRAS를 따라 이동 → 장기에는 산출이 자연산출로 돌아오고 물가·금리 수준만 달라짐`
    default:
      return null
  }
}

/** First period t ≥ 1 from which |Y_t − Ȳ| stays below `tol`. */
function settledAt(path: number[], Yn: number, tol: number): number | null {
  let at: number | null = null
  for (let t = path.length - 1; t >= 1; t--) {
    if (Math.abs(path[t] - Yn) < tol) at = t
    else break
  }
  return at
}

function explain(
  baseline: { input: ScenarioInput; solution: Solution },
  current: { input: ScenarioInput; solution: Solution },
): string[] {
  const regime = toRegime(current.input.regime)
  const baseRegime = toRegime(baseline.input.regime)
  const b = baseline.solution.values
  const c = current.solution.values
  const locked = new Set(LOCKS[regime].map((l) => l.key))
  const out: string[] = []

  if (regime !== baseRegime) {
    const name = (r: ADASRegime) => (r === 'money' ? '통화량 목표' : '금리 목표')
    out.push(`통화정책 운영 방식이 ‘${name(baseRegime)}’에서 ‘${name(regime)}’(으)로 바뀌었습니다. 금리 목표제에서는 AD가 물가와 무관하게 수직이 됩니다.`)
  }

  const changed = VARIABLES.filter((v) => !locked.has(v.key) && Math.abs(c[v.key] - b[v.key]) > EPS)
  for (const v of changed) {
    const s = chain(v.key, c[v.key] > b[v.key], regime)
    if (s) out.push(`${s}. (${v.symbol}: ${fmt(b[v.key], v.digits)} → ${fmt(c[v.key], v.digits)})`)
  }

  const moved = Math.abs(c.Y1 - c.Y0) > 1e-6 || Math.abs(c.P1 - c.P0) > 1e-9 || Math.abs(c.PLR - c.P0) > 1e-9 || !Number.isFinite(c.PLR)
  if (out.length === 0 && !moved) {
    return ['현재 상태가 기준점(장기 균형)과 같습니다. 정책 변수를 움직이면 단기와 장기에 무엇이 달라지는지 여기에 설명이 나타납니다.']
  }
  if (!moved) return out

  out.push(
    `단기(충격 직후 1기): 산출 Y ${fmt(c.Y0, 0)} → ${fmt(c.Y1, 0)} (${signed(c.Y1 - c.Y0, 0)}), 물가 P ${fmt(c.P0, 3)} → ${fmt(c.P1, 3)}, 금리 i ${fmt(c.i0, 2)}% → ${fmt(c.i1, 2)}%, 투자 I ${fmt(c.I0, 0)} → ${fmt(c.I1, 0)}.`,
  )
  if (Number.isFinite(c.PLR)) {
    out.push(
      `장기(LRAS 위): 산출 ${fmt(c.YLR, 0)}(자연산출), 물가 ${fmt(c.P0, 3)} → ${fmt(c.PLR, 3)}, 금리 ${fmt(c.i0, 2)}% → ${fmt(c.iLR, 2)}%, 실질금리 ${fmt(c.r0, 2)}% → ${fmt(c.rLR, 2)}%, 투자 ${fmt(c.I0, 0)} → ${fmt(c.ILR, 0)}.`,
    )
    const ys = current.solution.timePaths?.find((t) => t.key === 'Y')?.values ?? []
    const at = settledAt(ys, c.Yn, 1)
    if (at !== null && Math.abs(c.Y1 - c.Yn) >= 1) {
      out.push(`조정 과정: 기대 물가가 매기 직전 물가로 따라잡으면서 산출 갭이 한쪽 방향으로 줄어들고(진동 없는 단조 수렴), ${at}기부터 자연산출과의 차이가 1 미만입니다.`)
    }
  } else if (regime === 'rate' && c.drift !== 0) {
    out.push(`장기 균형이 없습니다: 금리가 고정된 채 산출이 ${fmt(c.Y1, 0)}에 머물러 물가가 매기 ${fmt(Math.abs(c.drift), 3)}씩 ${c.drift > 0 ? '오릅니다' : '내립니다'}.`)
  }

  const only = (key: string) => changed.length === 1 && changed[0].key === key && regime === baseRegime && regime === 'money'
  if (only('M') && Number.isFinite(c.PLR) && Number.isFinite(b.PLR)) {
    out.push(`화폐 중립성: 통화량이 ${fmt(c.M / b.M, 3)}배가 되자 장기 물가도 정확히 ${fmt(c.PLR / b.PLR, 3)}배가 되었고, 장기 산출·금리·투자는 그대로입니다. 통화량은 단기에만 실물 변수에 영향을 줍니다.`)
  }
  if (only('G') && Number.isFinite(c.ILR)) {
    out.push(`완전 구축: 장기에 산출은 자연산출 그대로이므로 재정지출 변화 ${signed(c.G - b.G, 0)}만큼 투자가 반대로 움직였습니다(투자 ${signed(c.ILR - c.I0, 0)}). 이를 위해 금리가 ${fmt(c.iLR, 2)}%까지 변했습니다.`)
  }
  return out
}

export const adasModel: ModelDefinition = {
  id: 'adas',
  name: 'AD-AS',
  variables: VARIABLES,
  regimes: [
    { id: 'money', label: '통화량 목표', description: '중앙은행이 통화량 M을 정합니다. 물가가 오르면 실질통화량이 줄어 AD가 우하향합니다.' },
    { id: 'rate', label: '금리 목표', description: '중앙은행이 금리 i를 고정합니다. AD가 수직이 되어 물가수준을 붙잡아 둘 장치가 없습니다.' },
  ],
  defaultRegime: 'money',
  regimeLabel: '통화정책 운영 방식',
  outputs: [
    { key: 'Y1', label: '단기 산출', symbol: 'Y₁', digits: 0 },
    { key: 'P1', label: '단기 물가', symbol: 'P₁', digits: 3 },
    { key: 'i1', label: '단기 금리', symbol: 'i₁', unit: '%', digits: 2 },
    { key: 'PLR', label: '장기 물가', symbol: 'P*', digits: 3 },
    { key: 'iLR', label: '장기 금리', symbol: 'i*', unit: '%', digits: 2 },
    { key: 'ILR', label: '장기 투자', symbol: 'I*', digits: 0 },
    { key: 'M1', label: '통화량', symbol: 'M₁', digits: 0 },
  ],
  axes: {
    x: { key: 'Y', label: '산출 Y', defaultDomain: DEFAULT_X },
    y: { key: 'P', label: '물가 P', digits: 2, defaultDomain: DEFAULT_Y },
  },
  equations: [
    { label: 'AD (통화량 목표: 물가 P에서의 IS-LM 균형)', latex: 'Y^{AD}(P) = \\dfrac{c_0 - c_1 T + b_0 + G + b_1 \\pi^e + \\frac{b_1}{h}\\frac{M}{P}}{1 - c_1 + \\frac{b_1 k}{h}}' },
    { label: 'AD (금리 목표: 수직)', latex: 'Y^{AD} = \\dfrac{c_0 - c_1 T + b_0 + G - b_1 (i - \\pi^e)}{1 - c_1}' },
    { label: '단기 총공급 SRAS', latex: 'P_t = P^e_t + \\dfrac{1}{a}\\,(Y_t - \\bar Y)' },
    { label: '적응적 기대', latex: 'P^e_{t+1} = P_t' },
    { label: '장기 균형 (LRAS: Y = Ȳ)', latex: 'Y^{AD}(P^*) = \\bar Y \\;\\Rightarrow\\; P^* = \\dfrac{\\frac{b_1}{h}M}{(1 - c_1 + \\frac{b_1 k}{h})\\bar Y - (c_0 - c_1 T + b_0 + G + b_1\\pi^e)}' },
  ],
  glossary: [
    { term: 'AD (총수요)', text: '재화시장과 화폐시장이 함께 균형을 이루는 (산출, 물가) 조합. 물가가 오르면 실질통화량이 줄어 금리가 오르고 투자가 줄므로 우하향합니다.' },
    { term: 'SRAS (단기 총공급)', text: '기대 물가가 주어졌을 때의 공급. 실제 물가가 기대보다 높으면 산출이 자연산출보다 커집니다.' },
    { term: 'LRAS (장기 총공급)', text: '기대가 실현된 상태(P = Pe)의 공급. 자연산출 Ȳ에서 수직입니다.' },
    { term: '자연산출', text: '물가 기대가 맞아떨어질 때의 산출 수준. 장기에는 총수요와 무관하게 이 값으로 돌아옵니다.' },
    { term: '화폐 중립성', text: '장기에 통화량 변화가 물가만 같은 비율로 바꾸고 산출·실질금리 같은 실물 변수는 바꾸지 못한다는 성질.' },
    { term: '적응적 기대', text: '사람들이 이번 기의 물가를 보고 다음 기 기대 물가를 정하는 방식(Pe_{t+1} = P_t). 기대가 늦게 따라오므로 단기에는 산출이 변합니다.' },
  ],
  timePathNote: `정책이 1기에 바뀐 뒤 ${ADAS_HORIZON}기까지의 조정 경로입니다. 0기는 기준점의 균형입니다. 아래 기간 슬라이더로 특정 기를 그래프와 함께 볼 수 있습니다.`,
  lockedVariables: (regime) => LOCKS[toRegime(regime)],
  solve,
  explain,
}
