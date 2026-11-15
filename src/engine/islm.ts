/**
 * IS-LM: linear, closed economy, fixed price level.
 *
 *   IS:     Y = c0 + c1 (Y − T) + b0 − b1 r + G
 *   LM:     M / P = k Y − h i
 *   Fisher: r = i − πe
 *
 * Interest rates are in percent. Two monetary-policy regimes:
 *   money — the central bank sets M; i is an outcome of the LM equation.
 *   rate  — the central bank sets i; LM is horizontal at i and M is the
 *           money supply needed to hold i there.
 */
import type {
  Curve,
  LockInfo,
  ModelDefinition,
  ScenarioInput,
  Solution,
  SolveOptions,
  TimePath,
  Values,
  VariableSpec,
  Warning,
} from './types'
import { linspace } from './view'

export type ISLMRegime = 'money' | 'rate'

export interface ISLMParams {
  c0: number
  c1: number
  T: number
  b0: number
  b1: number
  G: number
  M: number
  P: number
  k: number
  h: number
  /** Expected inflation πe (percent). */
  pe: number
  /** Policy rate, used only in the rate-target regime (percent). */
  i: number
}

export interface ISLMResult {
  Y: number
  i: number
  r: number
  C: number
  I: number
  M: number
  /** Real money supply M/P. */
  m: number
  /** dY* / dG in the current regime. */
  multG: number
}

/** Autonomous intercept parameters that are not exposed in the UI. */
export const ISLM_CONSTANTS = { c0: 200, b0: 200 } as const

export const ISLM_DEFAULTS: ISLMParams = {
  c0: 200,
  c1: 0.75,
  T: 100,
  b0: 200,
  b1: 25,
  G: 100,
  M: 1000,
  P: 2,
  k: 1,
  h: 100,
  pe: 0,
  i: 6,
}

/** Autonomous spending excluding the interest-rate term: c0 − c1 T + b0 + G. */
function autonomous(p: ISLMParams): number {
  return p.c0 - p.c1 * p.T + p.b0 + p.G
}

/** Fiscal multiplier dY* / dG with M fixed: 1 / (1 − c1 + b1 k / h). */
export function fiscalMultiplierMoney(p: ISLMParams): number {
  return 1 / (1 - p.c1 + (p.b1 * p.k) / p.h)
}

/** Monetary multiplier dY* / dM with M fixed: (b1 / (P h)) / (1 − c1 + b1 k / h). */
export function moneyMultiplier(p: ISLMParams): number {
  return (p.b1 / (p.P * p.h)) * fiscalMultiplierMoney(p)
}

function complete(p: ISLMParams, Y: number, i: number, M: number, multG: number): ISLMResult {
  const r = i - p.pe
  return {
    Y,
    i,
    r,
    C: p.c0 + p.c1 * (Y - p.T),
    I: p.b0 - p.b1 * r,
    M,
    m: M / p.P,
    multG,
  }
}

/** Money-target equilibrium (M given). */
export function solveMoneyTarget(p: ISLMParams): ISLMResult {
  const m = p.M / p.P
  const Y = (autonomous(p) + p.b1 * p.pe + (p.b1 / p.h) * m) * fiscalMultiplierMoney(p)
  const i = (p.k * Y - m) / p.h
  return complete(p, Y, i, p.M, fiscalMultiplierMoney(p))
}

/** Rate-target equilibrium (i given): Y from IS at r = i − πe, M from LM. */
export function solveRateTarget(p: ISLMParams): ISLMResult {
  const r = p.i - p.pe
  const Y = (autonomous(p) - p.b1 * r) / (1 - p.c1)
  const M = p.P * (p.k * Y - p.h * p.i)
  return complete(p, Y, p.i, M, 1 / (1 - p.c1))
}

export function solveISLM(p: ISLMParams, regime: ISLMRegime): ISLMResult {
  return regime === 'rate' ? solveRateTarget(p) : solveMoneyTarget(p)
}

/** IS curve in (Y, i) space: i = πe + (c0 − c1T + b0 + G − (1 − c1) Y) / b1. */
export function isRate(p: ISLMParams, Y: number): number {
  return p.pe + (autonomous(p) - (1 - p.c1) * Y) / p.b1
}

/** LM curve in (Y, i) space with M fixed: i = (k Y − M/P) / h. */
export function lmRate(p: ISLMParams, Y: number): number {
  return (p.k * Y - p.M / p.P) / p.h
}

// ---------------------------------------------------------------------------
// Model definition (metadata for the UI shell)
// ---------------------------------------------------------------------------

const VARIABLES: VariableSpec[] = [
  { key: 'G', label: '재정지출', symbol: 'G', min: 0, max: 300, step: 5, default: 100, group: 'policy', digits: 0, description: '정부가 재화·서비스를 구매하는 지출. 늘리면 IS 곡선이 오른쪽으로 이동합니다.' },
  { key: 'M', label: '통화량', symbol: 'M', min: 600, max: 1400, step: 10, default: 1000, group: 'policy', digits: 0, description: '명목 통화공급. 실질통화량 M/P가 LM 곡선의 위치를 정합니다.' },
  { key: 'i', label: '기준금리', symbol: 'i', unit: '%', min: 0, max: 12, step: 0.25, default: 6, group: 'policy', digits: 2, description: '중앙은행이 목표로 삼는 명목금리.' },
  { key: 'pe', label: '기대인플레이션', symbol: 'πe', unit: '%', min: -2, max: 5, step: 0.5, default: 0, group: 'policy', digits: 1, description: '사람들이 예상하는 물가상승률. 투자는 실질금리 r = i − πe에 반응합니다.' },
  { key: 'c1', label: '한계소비성향', symbol: 'c1', min: 0.5, max: 0.9, step: 0.01, default: 0.75, group: 'param', digits: 2, description: '가처분소득이 1 늘 때 소비가 늘어나는 비율.' },
  { key: 'b1', label: '투자의 금리 민감도', symbol: 'b1', min: 5, max: 50, step: 1, default: 25, group: 'param', digits: 0, description: '실질금리 1%p 상승 시 줄어드는 투자액.' },
  { key: 'k', label: '화폐수요의 소득 민감도', symbol: 'k', min: 0.5, max: 1.5, step: 0.05, default: 1, group: 'param', digits: 2, description: '소득이 1 늘 때 늘어나는 실질화폐수요.' },
  { key: 'h', label: '화폐수요의 금리 민감도', symbol: 'h', min: 50, max: 200, step: 5, default: 100, group: 'param', digits: 0, description: '금리 1%p 상승 시 줄어드는 실질화폐수요.' },
  { key: 'T', label: '조세', symbol: 'T', min: 0, max: 300, step: 5, default: 100, group: 'param', digits: 0, description: '정액세. 늘리면 가처분소득과 소비가 줄어 IS가 왼쪽으로 이동합니다.' },
  { key: 'P', label: '물가수준', symbol: 'P', min: 1, max: 4, step: 0.1, default: 2, group: 'param', digits: 1, description: '이 모형에서는 고정된 물가. 오르면 실질통화량 M/P가 줄어듭니다.' },
]

const LOCKS: Record<ISLMRegime, LockInfo[]> = {
  money: [
    { key: 'i', resultKey: 'i', reason: '통화량 목표제에서는 중앙은행이 M을 정하고, 금리 i는 화폐시장 균형(LM)에서 결정됩니다.' },
  ],
  rate: [
    { key: 'M', resultKey: 'M', reason: '금리 목표제에서는 중앙은행이 i를 고정하고, 그 금리를 유지하는 데 필요한 통화량 M이 LM 식에서 역산됩니다.' },
  ],
}

function toRegime(id: string): ISLMRegime {
  return id === 'rate' ? 'rate' : 'money'
}

function toParams(values: Values): ISLMParams {
  const p = { ...ISLM_DEFAULTS }
  for (const key of Object.keys(p) as (keyof ISLMParams)[]) {
    const v = values[key]
    if (typeof v === 'number' && Number.isFinite(v)) p[key] = v
  }
  return p
}

const DEFAULT_X: [number, number] = [600, 1600]

function solve(input: ScenarioInput, options: SolveOptions = {}): Solution {
  const regime = toRegime(input.regime)
  const p = toParams(input.values)
  const res = solveISLM(p, regime)
  const [x0, x1] = options.xDomain ?? DEFAULT_X
  const xs = linspace(x0, x1, 41)

  const curves: Curve[] = [
    { id: 'IS', label: 'IS', points: xs.map((Y) => ({ x: Y, y: isRate(p, Y) })) },
    regime === 'rate'
      ? { id: 'LM', label: `LM (i = ${fmt(p.i, 2)}%)`, points: xs.map((Y) => ({ x: Y, y: p.i })) }
      : { id: 'LM', label: 'LM', points: xs.map((Y) => ({ x: Y, y: lmRate(p, Y) })) },
  ]

  const warnings: Warning[] = []
  if (res.i < 0) {
    warnings.push({ key: 'i', message: `명목금리가 음수입니다(i = ${fmt(res.i, 2)}%). 현실에서는 명목금리가 0 아래로 크게 내려가기 어렵지만(실효하한), 이 선형 모형은 그 제약을 반영하지 않습니다.` })
  }
  if (res.M <= 0) {
    warnings.push({ key: 'M', message: '이 금리를 유지하는 데 필요한 통화량이 0 이하입니다. 모형상 실현될 수 없는 조합이니 금리를 낮추거나 재정지출을 늘려 보세요.' })
  }
  if (res.I < 0) {
    warnings.push({ key: 'I', message: '투자가 음수가 되었습니다. 선형 모형을 지나치게 멀리 적용한 결과로, 현실적인 해석은 어렵습니다.' })
  }
  if (res.Y <= 0) {
    warnings.push({ key: 'Y', message: '산출이 0 이하입니다. 파라미터 조합이 모형의 유효 범위를 벗어났습니다.' })
  }

  const values: Values = { ...p, ...res }
  const solution: Solution = {
    values,
    curves,
    equilibrium: { point: { x: res.Y, y: res.i }, label: 'E' },
    warnings,
  }
  if (options.baseline) solution.timePaths = stepPaths(options.baseline.values, values)
  return solution
}

function stepPaths(base: Values, cur: Values): TimePath[] {
  const make = (key: string, label: string, digits: number, unit?: string): TimePath => ({
    key,
    label,
    unit,
    digits,
    kind: 'step',
    periods: ['기준점', '현재'],
    values: [base[key], cur[key]],
  })
  return [make('Y', '산출 Y', 0), make('i', '금리 i', 2, '%'), make('I', '투자 I', 0)]
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

export function fmt(n: number, digits: number): string {
  if (!Number.isFinite(n)) return '—'
  const v = Math.abs(n) < 0.5 * 10 ** -digits ? 0 : n
  return v.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function signed(n: number, digits: number): string {
  const s = fmt(n, digits)
  if (s === fmt(0, digits)) return '변화 없음'
  return n > 0 ? `+${s}` : s.replace('-', '−')
}

const EPS = 1e-9

function chain(key: string, up: boolean, regime: ISLMRegime, cur: Values): string | null {
  const inc = up ? '증가' : '감소'
  const rise = up ? '상승' : '하락'
  const fall = up ? '하락' : '상승'
  const right = up ? '오른쪽' : '왼쪽'
  const left = up ? '왼쪽' : '오른쪽'
  const money = regime === 'money'
  switch (key) {
    case 'G':
      return money
        ? `재정지출 ${inc} → IS 곡선이 ${right}으로 이동 → 산출과 금리 ${rise} → 금리 ${rise}으로 투자 일부 ${up ? '감소(구축효과)' : '증가(구축효과의 반대)'}`
        : `재정지출 ${inc} → IS 곡선이 ${right}으로 이동 → 금리가 ${fmt(cur.i, 2)}%로 고정되어 투자는 그대로(구축효과 없음) → 산출이 단순승수 1/(1−c1)만큼 ${inc} → 금리를 유지하기 위해 중앙은행이 통화량을 ${up ? '늘림' : '줄임'}`
    case 'T':
      return money
        ? `조세 ${inc} → 가처분소득과 소비 ${up ? '감소' : '증가'} → IS 곡선이 ${left}으로 이동 → 산출과 금리 ${fall} → 투자 일부 ${up ? '증가' : '감소'}`
        : `조세 ${inc} → 가처분소득과 소비 ${up ? '감소' : '증가'} → IS 곡선이 ${left}으로 이동 → 금리가 고정되어 산출이 ${up ? '감소' : '증가'} → 통화량도 ${up ? '감소' : '증가'}`
    case 'M':
      return money
        ? `통화량 ${inc} → 실질통화공급 M/P ${inc} → LM 곡선이 ${up ? '오른쪽(아래)' : '왼쪽(위)'}으로 이동 → 금리 ${fall} → 투자 ${inc} → 산출 ${inc}`
        : null
    case 'i':
      return money
        ? null
        : `기준금리 ${up ? '인상' : '인하'} → 수평인 LM 곡선이 ${up ? '위' : '아래'}로 이동 → 실질금리 ${rise} → 투자 ${up ? '감소' : '증가'} → 산출 ${up ? '감소' : '증가'} → 줄어든(늘어난) 화폐수요에 맞춰 중앙은행이 통화량을 ${up ? '줄임' : '늘림'}`
    case 'pe':
      return money
        ? `기대인플레이션 ${rise} → 같은 명목금리에서 실질금리 r = i − πe ${fall} → 투자 ${inc} → (Y, i) 평면에서 IS 곡선이 πe 변화만큼 ${up ? '위' : '아래'}로 이동 → 산출과 명목금리 ${rise}, 실질금리는 ${fall}`
        : `기대인플레이션 ${rise} → 명목금리가 고정되어 실질금리가 πe 변화만큼 ${fall} → 투자 ${inc} → 산출 ${inc} → 늘어난(줄어든) 화폐수요에 맞춰 통화량 ${inc}`
    case 'P':
      return money
        ? `물가수준 ${rise} → 실질통화공급 M/P ${up ? '감소' : '증가'} → LM 곡선이 ${left}(${up ? '위' : '아래'})으로 이동 → 금리 ${rise} → 투자와 산출 ${up ? '감소' : '증가'}`
        : `물가수준 ${rise} → 같은 금리를 유지하려면 명목통화량이 물가에 비례해 ${inc}해야 함 → 산출과 금리는 그대로`
    case 'c1':
      return `한계소비성향 ${up ? '상승' : '하락'} → 소득 중 소비되는 몫이 ${up ? '커져' : '작아져'} 승수가 ${up ? '커지고' : '작아지고'}, IS 곡선이 ${up ? '완만해짐' : '가팔라짐'} → (정액세 T가 있으므로) IS의 위치도 함께 변함`
    case 'b1':
      return `투자의 금리 민감도 ${up ? '상승' : '하락'} → IS 곡선이 ${up ? '완만해짐' : '가팔라짐'} → 금리 변화가 투자와 산출에 ${up ? '더 크게' : '더 작게'} 영향`
    case 'k':
      return money
        ? `화폐수요의 소득 민감도 ${up ? '상승' : '하락'} → LM 곡선이 ${up ? '가팔라짐' : '완만해짐'} → 같은 산출에서 화폐수요가 ${up ? '늘어' : '줄어'} 금리 ${rise} → 산출 ${up ? '감소' : '증가'}`
        : `화폐수요의 소득 민감도 ${up ? '상승' : '하락'} → 금리가 고정되어 산출은 그대로, 필요한 통화량만 ${inc}`
    case 'h':
      return money
        ? `화폐수요의 금리 민감도 ${up ? '상승' : '하락'} → LM 곡선이 ${up ? '완만해짐' : '가팔라짐'} → 재정정책의 구축효과는 ${up ? '작아지고' : '커지고'} 통화정책의 효과는 ${up ? '작아짐' : '커짐'}`
        : `화폐수요의 금리 민감도 ${up ? '상승' : '하락'} → 금리가 고정되어 산출은 그대로, 같은 금리를 유지하는 데 필요한 통화량은 ${up ? '감소' : '증가'}`
    default:
      return null
  }
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
    const name = (r: ISLMRegime) => (r === 'money' ? '통화량 목표' : '금리 목표')
    out.push(`통화정책 운영 방식이 ‘${name(baseRegime)}’에서 ‘${name(regime)}’(으)로 바뀌었습니다. 새로 조작하게 된 변수는 직전 균형값에서 출발하므로, 방식 전환 자체로는 균형이 바뀌지 않습니다.`)
  }

  const changed = VARIABLES.filter((v) => !locked.has(v.key) && Math.abs(c[v.key] - b[v.key]) > EPS)
  for (const v of changed) {
    const s = chain(v.key, c[v.key] > b[v.key], regime, c)
    if (s) out.push(`${s}. (${v.symbol}: ${fmt(b[v.key], v.digits)} → ${fmt(c[v.key], v.digits)})`)
  }

  const dY = c.Y - b.Y
  const di = c.i - b.i
  const moved = Math.abs(dY) > 1e-6 || Math.abs(di) > 1e-6 || Math.abs(c.M - b.M) > 1e-6
  if (out.length === 0 && !moved) {
    return ['현재 상태가 기준점과 같습니다. 왼쪽의 정책 변수를 움직이면 균형이 어떻게 바뀌는지 여기에 설명이 나타납니다.']
  }

  if (moved) {
    const parts = [
      `산출 Y ${fmt(b.Y, 0)} → ${fmt(c.Y, 0)} (${signed(dY, 0)})`,
      `명목금리 i ${fmt(b.i, 2)}% → ${fmt(c.i, 2)}% (${signed(di, 2)}${Math.abs(di) > 0.005 ? '%p' : ''})`,
      `실질금리 r ${fmt(b.r, 2)}% → ${fmt(c.r, 2)}%`,
      `소비 C ${fmt(b.C, 0)} → ${fmt(c.C, 0)} (${signed(c.C - b.C, 0)})`,
      `투자 I ${fmt(b.I, 0)} → ${fmt(c.I, 0)} (${signed(c.I - b.I, 0)})`,
    ]
    if (regime === 'rate' || baseRegime === 'rate' || Math.abs(c.M - b.M) > 1e-6) {
      parts.push(`통화량 M ${fmt(b.M, 0)} → ${fmt(c.M, 0)}`)
    }
    out.push(`결과(기준점 → 현재): ${parts.join(', ')}.`)
  }

  // Quantify crowding out when only G changed under a money target.
  const onlyG = changed.length === 1 && changed[0].key === 'G' && regime === baseRegime
  if (onlyG && regime === 'money') {
    const dG = c.G - b.G
    const noCrowd = dG / (1 - c.c1)
    if (dG > 0) {
      out.push(`금리가 그대로였다면 산출은 ΔG/(1−c1) = ${fmt(noCrowd, 0)}만큼 늘었겠지만, 금리 상승으로 투자가 ${fmt(b.I - c.I, 0)} 줄어(구축효과) 실제로는 ${fmt(dY, 0)}만큼만 늘었습니다. 이때 재정승수는 ${fmt(c.multG, 2)}입니다.`)
    } else {
      out.push(`금리가 그대로였다면 산출은 ${fmt(-noCrowd, 0)}만큼 줄었겠지만, 금리 하락으로 투자가 ${fmt(c.I - b.I, 0)} 늘어 실제 감소폭은 ${fmt(-dY, 0)}에 그쳤습니다.`)
    }
  }
  return out
}

export const islmModel: ModelDefinition = {
  id: 'islm',
  name: 'IS-LM',
  variables: VARIABLES,
  regimes: [
    { id: 'money', label: '통화량 목표', description: '중앙은행이 통화량 M을 정하고 금리는 시장에서 결정됩니다.' },
    { id: 'rate', label: '금리 목표', description: '중앙은행이 금리 i를 정하고 필요한 만큼 통화를 공급합니다.' },
  ],
  defaultRegime: 'money',
  regimeLabel: '통화정책 운영 방식',
  outputs: [
    { key: 'Y', label: '산출', symbol: 'Y*', digits: 0 },
    { key: 'i', label: '명목금리', symbol: 'i*', unit: '%', digits: 2 },
    { key: 'r', label: '실질금리', symbol: 'r*', unit: '%', digits: 2 },
    { key: 'C', label: '소비', symbol: 'C', digits: 0 },
    { key: 'I', label: '투자', symbol: 'I', digits: 0 },
    { key: 'M', label: '통화량', symbol: 'M', digits: 0 },
    { key: 'multG', label: '재정승수', symbol: 'dY/dG', digits: 2 },
  ],
  axes: {
    x: { key: 'Y', label: '산출 Y', defaultDomain: DEFAULT_X },
    y: { key: 'i', label: '금리 i', unit: '%', defaultDomain: [0, 12] },
  },
  equations: [
    { label: 'IS (재화시장 균형)', latex: 'Y = c_0 + c_1 (Y - T) + b_0 - b_1 r + G' },
    { label: 'LM (화폐시장 균형)', latex: '\\dfrac{M}{P} = kY - h\\,i' },
    { label: '피셔 방정식', latex: 'r = i - \\pi^e' },
    {
      label: '균형 산출 (통화량 목표)',
      latex: 'Y^* = \\dfrac{c_0 - c_1 T + b_0 + G + b_1 \\pi^e + \\frac{b_1}{h}\\frac{M}{P}}{1 - c_1 + \\frac{b_1 k}{h}}',
    },
    { label: '재정승수', latex: '\\dfrac{dY^*}{dG} = \\dfrac{1}{1 - c_1 + b_1 k / h}' },
  ],
  glossary: [
    { term: 'IS 곡선', text: '재화시장이 균형을 이루는 (산출, 금리) 조합. 금리가 오르면 투자가 줄어 산출이 줄므로 우하향합니다.' },
    { term: 'LM 곡선', text: '화폐시장이 균형을 이루는 조합. 산출이 늘면 화폐수요가 늘어 금리가 올라야 하므로 우상향합니다.' },
    { term: '구축효과', text: '재정지출 증가가 금리를 올려 민간투자를 밀어내는 현상.' },
    { term: '실질금리', text: '명목금리에서 기대인플레이션을 뺀 값. 투자 결정은 실질금리에 달려 있습니다.' },
  ],
  lockedVariables: (regime) => LOCKS[toRegime(regime)],
  solve,
  explain,
}
