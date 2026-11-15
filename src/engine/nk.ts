/** Three-equation New Keynesian model. One period = one year; rates in %. */
import { fmt } from './islm'
import { clipLine } from './ismppc'
import type { Curve, ModelDefinition, ScenarioInput, Solution, SolveOptions, Values, VariableSpec } from './types'

export const NK_HORIZON = 40
const EPS = 1e-9

export interface NKParams {
  phiPi: number
  phiX: number
  piStar: number
  d: number
  u: number
  v: number
  rhoD: number
  rhoU: number
  rhoV: number
  beta: number
  sigma: number
  kappa: number
  rn: number
}

export const NK_DEFAULTS: NKParams = {
  phiPi: 1.5, phiX: 0.5, piStar: 2,
  d: 0, u: 0, v: 0, rhoD: 0.5, rhoU: 0.5, rhoV: 0.5,
  beta: 0.96, sigma: 1, kappa: 0.3, rn: 2,
}

export function toNKParams(values: Values): NKParams {
  const p = { ...NK_DEFAULTS }
  for (const k of Object.keys(p) as (keyof NKParams)[]) {
    if (Number.isFinite(values[k])) p[k] = values[k]
  }
  return p
}

export function determinacy(p: NKParams): number {
  return p.kappa * (p.phiPi - 1) + (1 - p.beta) * p.phiX
}

/** Cramer's rule for x = a z and π − π* = b z, one AR(1) shock at a time. */
export function shockCoefficients(p: NKParams, shock: 'd' | 'u' | 'v', rho: number) {
  const A = 1 - rho + p.sigma * p.phiX
  const B = p.sigma * (p.phiPi - rho)
  const C = 1 - p.beta * rho
  const det = A * C + p.kappa * B
  const rhs1 = shock === 'd' ? 1 : shock === 'v' ? -p.sigma : 0
  const rhs2 = shock === 'u' ? 1 : 0
  return Math.abs(det) < EPS ? null : {
    a: (C * rhs1 - B * rhs2) / det,
    b: (p.kappa * rhs1 + A * rhs2) / det,
  }
}

const SHOCKS = [['d', 'rhoD'], ['u', 'rhoU'], ['v', 'rhoV']] as const

export interface NKPeriod {
  t: number
  x: number
  Y: number
  pi: number
  i: number
  r: number
  ExNext: number
  EpiNext: number
  d: number
  u: number
  v: number
}

/** The bounded fundamental solution; null if it is not uniquely determined. */
export function solveNKPeriod(p: NKParams, t: number): NKPeriod | null {
  if (t === 0) return { t, x: 0, Y: 100, pi: p.piStar, i: p.rn + p.piStar, r: p.rn, ExNext: 0, EpiNext: p.piStar, d: 0, u: 0, v: 0 }
  if (determinacy(p) < EPS) return null
  let x = 0
  let gap = 0
  let ExNext = 0
  let EpiNext = p.piStar
  const shocks = { d: 0, u: 0, v: 0 }
  for (const [key, rhoKey] of SHOCKS) {
    const rho = p[rhoKey]
    const c = shockCoefficients(p, key, rho)
    if (!c) return null
    const z = p[key] * rho ** (t - 1)
    shocks[key] = z
    x += c.a * z
    gap += c.b * z
    ExNext += rho * c.a * z
    EpiNext += rho * c.b * z
  }
  const pi = p.piStar + gap
  const i = p.rn + p.piStar + p.phiPi * gap + p.phiX * x + shocks.v
  return { t, x, Y: 100 + x, pi, i, r: i - EpiNext, ExNext, EpiNext, ...shocks }
}

const variable = (key: keyof NKParams, label: string, symbol: string, min: number, max: number, step: number, digits: number, section: string, description: string, group: 'policy' | 'param' = 'policy'): VariableSpec => ({
  key, label, symbol, min, max, step, digits, section, description, group, default: NK_DEFAULTS[key],
})

const VARIABLES: VariableSpec[] = [
  variable('phiPi', '물가 반응 계수', 'φπ', 0, 3, 0.05, 2, '정책 변수', '물가상승률이 목표보다 1%p 높을 때 명목금리를 φπ%p 올립니다. 보통 1보다 커야 유일한 균형이 정해집니다.'),
  variable('phiX', '산출 반응 계수', 'φx', 0, 2, 0.05, 2, '정책 변수', '산출 갭이 1% 커지면 명목금리를 φx%p 올립니다.'),
  variable('piStar', '물가목표', 'π*', 0, 6, 0.25, 2, '정책 변수', '신뢰받는 물가목표. 합리적 기대는 새 목표를 즉시 반영합니다.'),
  { key: 'Mend', label: '통화량', symbol: 'M', min: 0, max: 1, step: 1, digits: 0, default: 0, group: 'policy', section: '정책 변수', description: '' },
  ...SHOCKS.flatMap(([key, rhoKey]) => {
    const label = { d: '수요 충격', u: '비용 인상 충격', v: '통화정책 충격' }[key]
    return [
      variable(key, label, key, -3, 3, 0.25, 2, label, '1기에 주는 충격의 크기. 이후에는 매년 지속성 ρ배로 줄어듭니다.'),
      variable(rhoKey, '지속성', `ρ${key}`, 0, 0.95, 0.05, 2, label, '0이면 1기에만 발생하고, 0.5이면 매년 절반으로 줄어듭니다. 영구 충격은 포함하지 않습니다.'),
    ]
  }),
  variable('beta', '할인인자', 'β', 0.9, 0.999, 0.001, 3, '파라미터', 'NK 필립스 곡선에서 미래 물가 갭에 부여하는 가중치.', 'param'),
  variable('sigma', '수요의 실질금리 민감도', 'σ', 0.2, 3, 0.1, 1, '파라미터', '기대 실질금리가 자연이자율보다 1%p 높을 때 산출 갭이 σ% 줄어듭니다.', 'param'),
  variable('kappa', '필립스 곡선 기울기', 'κ', 0.02, 1, 0.01, 2, '파라미터', '산출 갭 1%가 현재 물가상승률을 κ%p 움직입니다.', 'param'),
  variable('rn', '자연이자율', 'rⁿ', 0, 5, 0.25, 2, '파라미터', '정상상태의 실질금리. 정상상태 명목금리는 rⁿ + π*입니다.', 'param'),
]

const XD: [number, number] = [94, 106]
const YD: [number, number] = [-1, 6]

/** Hold the period's rational expectations fixed while drawing the two equations. */
function periodCurves(p: NKParams, s: NKPeriod, xd: [number, number], yd: [number, number]): Curve[] {
  const rhs = s.ExNext + p.sigma * (s.EpiNext - p.piStar) + s.d - p.sigma * s.v
  // Sample along inflation, so φπ = 0 (or arbitrarily close to zero) needs
  // no division by φπ and produces a vertical AD without numerical overflow.
  const A = 1 + p.sigma * p.phiX
  const ad = clipLine({ x: p.piStar, y: 100 + rhs / A }, -p.sigma * p.phiPi / A, yd, xd)
    .map((q) => ({ x: q.y, y: q.x })).sort((a, b) => a.x - b.x || a.y - b.y)
  return [
    { id: 'AD', label: 'AD', tone: 'primary', points: ad },
    { id: 'NKPC', label: 'NKPC', tone: 'secondary', points: clipLine({ x: 100, y: p.piStar + p.beta * (s.EpiNext - p.piStar) + s.u }, p.kappa, xd, yd) },
  ]
}

function solve(input: ScenarioInput, options: SolveOptions = {}): Solution {
  const p = toNKParams(input.values)
  const base = options.baseline ? toNKParams(options.baseline.values) : p
  const xd = options.xDomain ?? XD
  const yd = options.yDomain ?? YD
  const condition = determinacy(p)
  const status = Math.abs(condition) < EPS ? 'unit' : condition > 0 ? 'stable' : 'unstable'
  const singular = SHOCKS.some(([key, rho]) => !shockCoefficients(p, key, p[rho]))
  const valid = status === 'stable' && !singular
  const path = Array.from({ length: NK_HORIZON + 1 }, (_, t) => t === 0 ? solveNKPeriod(base, 0) : valid ? solveNKPeriod(p, t) : null)
  const point = (s: NKPeriod | null) => ({ x: s?.Y ?? Number.NaN, y: s?.pi ?? Number.NaN })
  const first = path[1]
  const values: Values = { ...p, Mend: Number.NaN }
  for (const key of ['Y', 'pi', 'i', 'r'] as const) {
    values[key + '0'] = path[0]![key]
    values[key + '1'] = first?.[key] ?? Number.NaN
    values[key + 'LR'] = valid ? key === 'Y' ? 100 : key === 'pi' ? p.piStar : key === 'i' ? p.rn + p.piStar : p.rn : Number.NaN
  }
  const curves = path.map((s, t) => s ? periodCurves(t === 0 ? base : p, s, xd, yd) : [])
  return {
    values,
    curves: [...curves[1], { id: 'LRAS', label: 'Ȳ = 100', tone: 'reference', points: [{ x: 100, y: yd[0] }, { x: 100, y: yd[1] }] }],
    equilibrium: { point: point(first), label: 'E₁' },
    markers: [
      { point: point(path[0]), label: 'E₀', kind: 'baseline' },
      ...(first ? [{ point: point(first), label: 'E₁', kind: 'short' as const }, { point: { x: 100, y: p.piStar }, label: '장기', kind: 'long' as const }] : []),
    ],
    trajectory: { points: path.map(point), curves, fitUntil: NK_HORIZON, curvesFollowPeriod: true },
    timePaths: (['Y', 'pi', 'i', 'r'] as const).map((key, j) => ({
      key, label: ['산출 Y', '물가상승률 π', '명목금리 i', '실질금리 r'][j],
      unit: key === 'Y' ? undefined : '%', digits: 2, kind: 'dynamic',
      periods: path.map((_, t) => String(t)), values: path.map((s) => s?.[key] ?? Number.NaN),
      reference: { value: [100, p.piStar, p.rn + p.piStar, p.rn][j], label: ['Ȳ', 'π*', 'rⁿ + π*', 'rⁿ'][j] },
    })),
    stability: {
      label: '결정성 조건', value: fmt(condition, 3), status,
      text: '테일러 원칙의 뉴케인지언 버전: 보통 φπ > 1 근처에서 유일한 균형이 정해지며, 산출 반응도 조건에 영향을 줍니다. IS-MP-PC의 θπ > 0과 기준이 다릅니다. 여기서는 φπ가 명목금리의 전체 반응이므로 물가 1%p에 금리가 1%p보다 더 움직여야 합니다.',
      latex: '\\kappa(\\phi_\\pi-1)+(1-\\beta)\\phi_x > 0',
    },
    warnings: [
      ...(status !== 'stable' ? [{ message: status === 'unit' ? '결정성 조건의 경계: 유일한 균형이 보장되지 않아 경로를 표시하지 않습니다.' : '유일한 균형이 없음(비결정성): 테일러 원칙을 만족하도록 준칙 계수를 조정해 주세요.' }] : []),
      ...(singular ? [{ message: '충격별 연립방정식의 행렬식이 0에 가깝습니다(|det| < 1e-9). 해와 경로를 표시하지 않습니다.' }] : []),
    ],
  }
}

function explain(_baseline: { input: ScenarioInput; solution: Solution }, current: { input: ScenarioInput; solution: Solution }): string[] {
  const p = toNKParams(current.input.values)
  if (current.solution.warnings.length) return current.solution.warnings.map((w) => w.message)
  const out: string[] = []
  const direction = (x: number) => Math.abs(x) < EPS ? '변화 없음' : x > 0 ? '상승' : '하락'
  for (const [key, rhoKey] of SHOCKS) {
    if (p[key] === 0) continue
    const one = solveNKPeriod({ ...p, d: 0, u: 0, v: 0, [key]: p[key] }, 1)!
    const positive = p[key] > 0
    const chain = key === 'd' ? `수요 충격 → AD ${positive ? '오른쪽' : '왼쪽'} 이동`
      : key === 'v' ? `통화정책 ${positive ? '긴축' : '완화'} 충격 → 같은 산출·물가에서 준칙 금리 ${positive ? '인상' : '인하'} → AD ${positive ? '왼쪽' : '오른쪽'} 이동`
        : `비용 ${positive ? '인상' : '하락'} 충격 → NKPC ${positive ? '위' : '아래'} 이동`
    const rho = p[rhoKey]
    out.push(`${chain} → 산출 ${direction(one.x)}·물가 ${direction(one.pi - p.piStar)}, 명목금리 ${direction(one.i - p.rn - p.piStar)}·실질금리 ${direction(one.r - p.rn)}. 미래 충격도 예상하므로 두 곡선에 그 기의 기대값이 반영됩니다. ${key}₁ = ${fmt(p[key], 2)}, ρ = ${fmt(rho, 2)}: ${rho === 0 ? '2기에 정확히 정상상태로 복귀' : `반감기 ${fmt(Math.log(0.5) / Math.log(rho), 2)}년(충격이 매년 ρ배로 감소)`}.`)
  }
  if (!out.length) out.push('경제가 정상상태(Y = 100, π = π*, i = rⁿ + π*, r = rⁿ)에 있습니다. 수요·비용·통화정책 충격과 지속성을 바꾸어 반응을 비교해 보세요.')
  const v = current.solution.values
  out.push(`1기(충격 직후): 산출 Y ${fmt(v.Y1, 2)}, 물가상승률 π ${fmt(v.pi1, 2)}%, 명목금리 i ${fmt(v.i1, 2)}%, 실질금리 r ${fmt(v.r1, 2)}%. 장기에는 Y = 100, π = ${fmt(p.piStar, 2)}%로 돌아갑니다.`)
  out.push('수요·통화 충격에서는 φπ가 클수록 물가 반응이 작아집니다. 비용 충격이 없을 때 물가 안정과 산출 갭 안정이 함께 가능하다는 성질이 신적 일치입니다. 비용 인상 충격에서는 물가를 더 억제하려면 산출을 더 줄여야 하므로 두 목표 사이에 상충관계가 생깁니다.')
  out.push('IS-MP-PC의 적응적 기대와 달리 합리적 기대는 전방 주시적이어서 물가가 충격 즉시 움직입니다. 충격이 사라지면 곧바로 정상상태로 돌아가며, ρ = 0이면 2기에 정확히 복귀합니다. 각 기의 기대는 다음 기 균형값과 일치합니다(0기는 예상 밖 충격 이전의 정상상태).')
  if (p.phiPi === 0) out.push('φπ = 0에서는 준칙이 물가에 반응하지 않아 AD가 수직선입니다. 산출 반응이 충분히 크면 결정성 조건은 만족할 수 있습니다.')
  return out
}

export const nkModel: ModelDefinition = {
  id: 'nk', name: '뉴케인지언', variables: VARIABLES,
  regimes: [{ id: 'taylor', label: '테일러 준칙', description: '명목금리가 물가와 산출 갭에 반응합니다. 한 기간은 1년이며 기대는 합리적 기대입니다.' }],
  defaultRegime: 'taylor', regimeLabel: '통화정책 운영 방식',
  lockedVariables: () => [{ key: 'Mend', resultKey: 'Mend', reason: '준칙 금리에 맞춰 내생적으로 결정되는 결과값입니다. 화폐수요 식이 없어 통화량 수치는 표시하지 않습니다.' }],
  outputs: [
    { key: 'Y1', label: '1기 산출', symbol: 'Y₁', digits: 2 },
    { key: 'pi1', label: '1기 물가상승률', symbol: 'π₁', unit: '%', digits: 2 },
    { key: 'i1', label: '1기 명목금리', symbol: 'i₁', unit: '%', digits: 2 },
    { key: 'r1', label: '1기 실질금리', symbol: 'r₁', unit: '%', digits: 2 },
    { key: 'YLR', label: '장기 산출', symbol: 'Y*', digits: 2 },
    { key: 'piLR', label: '장기 물가상승률', symbol: 'π*', unit: '%', digits: 2 },
  ],
  axes: { x: { key: 'Y', label: '산출 Y = 100 + x', digits: 2, defaultDomain: XD }, y: { key: 'pi', label: '물가상승률 π', unit: '%', digits: 2, defaultDomain: YD } },
  equations: [
    { label: '동태적 IS', latex: 'x_t = E_t x_{t+1} - \\sigma(i_t-E_t\\pi_{t+1}-r^n)+d_t' },
    { label: 'NK 필립스 곡선', latex: '\\pi_t-\\pi^* = \\beta(E_t\\pi_{t+1}-\\pi^*)+\\kappa x_t+u_t' },
    { label: '테일러 준칙', latex: 'i_t=r^n+\\pi^*+\\phi_\\pi(\\pi_t-\\pi^*)+\\phi_x x_t+v_t' },
    { label: '충격의 지속성 (z ∈ {d, u, v})', latex: 'z_t=\\rho_z z_{t-1}\\quad(t\\ge2),\\qquad z_1=\\text{충격 크기},\\quad Y_t=100+x_t' },
    { label: '미정계수법 (충격마다 풀이 후 합산)', latex: '\\begin{pmatrix}1-\\rho+\\sigma\\phi_x&\\sigma(\\phi_\\pi-\\rho)\\\\-\\kappa&1-\\beta\\rho\\end{pmatrix}\\begin{pmatrix}a\\\\b\\end{pmatrix}=\\begin{pmatrix}\\mathbf1_d-\\sigma\\mathbf1_v\\\\\\mathbf1_u\\end{pmatrix}' },
  ],
  glossary: [
    { term: '합리적 기대', text: '모형과 알려진 충격 경로에 맞춰 기대를 형성합니다. 여기서는 다음 기 기대값과 실제 균형값이 같습니다.' },
    { term: '전방 주시', text: '현재의 산출과 물가가 미래 산출·물가에 대한 기대에도 반응합니다.' },
    { term: '결정성', text: '안정적인 합리적 기대 균형이 유일하게 정해지는 성질. 조건이 깨지면 특정 경로를 임의로 선택하지 않습니다.' },
    { term: '신적 일치 (divine coincidence)', text: '비용 충격이 없으면 물가 안정과 산출 갭 안정을 동시에 달성할 수 있습니다.' },
    { term: '비용 인상 충격의 상충관계', text: '물가를 더 강하게 억제하는 정책은 산출 감소를 더 크게 만들 수 있습니다.' },
  ],
  timePathNote: '0기: 충격 이전 정상상태. 1~40기: 합리적 기대 균형. 점선은 각 변수의 정상상태입니다.',
  solve, explain,
}
