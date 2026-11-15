/**
 * Model-agnostic engine interface.
 *
 * Every model (IS-LM, AD-AS, IS-MP-PC, New Keynesian, ...) implements
 * `ModelDefinition`. The UI shell only talks to this interface, so adding a
 * model means adding a definition to the registry, not changing the UI.
 *
 * This module is pure TypeScript: no React, no DOM.
 */

export type ModelId = 'islm' | 'adas' | 'ismppc' | 'nk'

/** Flat bag of numeric inputs (policy variables + parameters), keyed by `VariableSpec.key`. */
export type Values = Record<string, number>

export interface VariableSpec {
  key: string
  /** Korean label, e.g. "재정지출". */
  label: string
  /** Symbol shown next to the label (plain text, e.g. "G", "πe"). */
  symbol: string
  unit?: string
  min: number
  max: number
  step: number
  default: number
  /** 'policy' variables go in the main panel, 'param' in the collapsible parameter section. */
  group: 'policy' | 'param'
  /** One-line explanation for undergraduates. */
  description: string
  /** Decimal places used when displaying the value. */
  digits: number
}

export interface RegimeSpec {
  id: string
  label: string
  description: string
}

/** A variable the user cannot set in the current regime: it is an outcome. */
export interface LockInfo {
  key: string
  /** Key into `Solution.values` holding the resulting value to display. */
  resultKey: string
  reason: string
}

export interface OutputSpec {
  key: string
  label: string
  symbol: string
  unit?: string
  digits: number
}

export interface AxisSpec {
  key: string
  label: string
  unit?: string
  /** Decimal places for value tags and tooltips (default 2). */
  digits?: number
  /** Default visible range; widened (never narrowed) to fit equilibria. */
  defaultDomain: [number, number]
}

export interface Point {
  x: number
  y: number
}

/**
 * How a curve is drawn: 'primary' / 'secondary' are the two model curves
 * (IS/LM, AD/SRAS), 'reference' a neutral guide such as LRAS.
 * Defaults to primary for the first curve and secondary otherwise.
 */
export type CurveTone = 'primary' | 'secondary' | 'reference'

export interface Curve {
  id: string
  label: string
  /** Points sorted by ascending x (a vertical curve has equal x values). */
  points: Point[]
  tone?: CurveTone
}

/**
 * A time path. Static models give a two-period before→after step;
 * dynamic models give an impulse response over many periods.
 */
export interface TimePath {
  key: string
  label: string
  unit?: string
  digits: number
  kind: 'step' | 'dynamic'
  periods: string[]
  /** May contain NaN for periods the model cannot report (drawn as a gap). */
  values: number[]
  /** Optional horizontal reference line, e.g. natural output Ȳ. */
  reference?: { value: number; label: string }
}

export interface Warning {
  /** Output or variable key the warning is about, if any. */
  key?: string
  message: string
}

export interface Equilibrium {
  point: Point
  label: string
}

/** A labelled point on the equilibrium graph (e.g. E₀, short run, long run). */
export interface Marker {
  point: Point
  label: string
  kind: 'baseline' | 'short' | 'long'
}

/**
 * Period-by-period adjustment of a dynamic model on the equilibrium graph.
 * `points[t]` is the equilibrium in period t = 0…horizon; `curves[t]` the
 * curves that belong to that period (e.g. SRAS_t), drawn when t is selected.
 */
export interface Trajectory {
  points: Point[]
  curves: Curve[][]
  /** Graph ranges are fitted to points[0…fitUntil] (later points may leave the box). */
  fitUntil: number
}

export interface Solution {
  /** Every reported number: endogenous outcomes and echoed inputs. */
  values: Values
  curves: Curve[]
  equilibrium: Equilibrium
  timePaths?: TimePath[]
  /** When present, the graph draws these instead of the default E / E₀ pair. */
  markers?: Marker[]
  trajectory?: Trajectory
  warnings: Warning[]
}

export interface ScenarioInput {
  regime: string
  values: Values
}

export interface SolveOptions {
  /** Baseline solution, used by static models to build before→after paths. */
  baseline?: Solution
  /** Horizontal range over which to sample curves. */
  xDomain?: [number, number]
  /** Vertical range, for curves that are easier to sample along y (e.g. AD). */
  yDomain?: [number, number]
}

export interface EquationSpec {
  label: string
  latex: string
}

export interface ModelDefinition {
  id: ModelId
  name: string
  variables: VariableSpec[]
  regimes: RegimeSpec[]
  defaultRegime: string
  regimeLabel: string
  outputs: OutputSpec[]
  axes: { x: AxisSpec; y: AxisSpec }
  equations: EquationSpec[]
  /** Short glossary of terms shown with the equations. */
  glossary: { term: string; text: string }[]
  /** Short note shown at the top of the time-path panel. */
  timePathNote?: string
  /** Which variables are outcomes (not controllable) in a regime, and why. */
  lockedVariables(regime: string): LockInfo[]
  solve(input: ScenarioInput, options?: SolveOptions): Solution
  /** Korean sentences describing the change from baseline to current. */
  explain(baseline: { input: ScenarioInput; solution: Solution }, current: { input: ScenarioInput; solution: Solution }): string[]
}

/** Registry entry: a model may be listed (tab visible) before it is implemented. */
export interface ModelEntry {
  id: ModelId
  name: string
  definition: ModelDefinition | null
}
