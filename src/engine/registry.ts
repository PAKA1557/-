import { adasModel } from './adas'
import { islmModel } from './islm'
import { ismppcModel } from './ismppc'
import { nkModel } from './nk'
import type { ModelDefinition, ModelEntry, ModelId } from './types'

/** All model tabs in display order. Unimplemented models would have `definition: null`. */
export const MODELS: ModelEntry[] = [
  { id: 'islm', name: 'IS-LM', definition: islmModel },
  { id: 'adas', name: 'AD-AS', definition: adasModel },
  { id: 'ismppc', name: 'IS-MP-PC', definition: ismppcModel },
  { id: 'nk', name: '뉴케인지언', definition: nkModel },
]

export const DEFAULT_MODEL: ModelId = 'islm'

export function getModel(id: ModelId): ModelDefinition | null {
  return MODELS.find((m) => m.id === id)?.definition ?? null
}

export function isModelId(s: string): s is ModelId {
  return MODELS.some((m) => m.id === s)
}
