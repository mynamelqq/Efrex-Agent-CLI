import { ReasoningEffort } from "openai/resources";
export type  { ReasoningEffort}

export const EFFORT_LEVELS = [
    'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[]
export type EffortValue = ReasoningEffort | number
export function isEffortLevel(value: unknown): value is ReasoningEffort {
  return (
    typeof value === 'string' 
    && (EFFORT_LEVELS as readonly string[]).includes(value)
  );
}
export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number' && isValidNumericEffort(value)) {
    return value
  }
  const str = String(value).toLowerCase()
  if (isEffortLevel(str)) {
    return str
  }
  const numericValue = parseInt(str, 10)
  if (!isNaN(numericValue) && isValidNumericEffort(numericValue)) {
    return numericValue
  }
  return undefined
}

export function convertEffortValueToLevel(value: EffortValue): ReasoningEffort {
  if (typeof value === 'string') {
    // Runtime guard: value may come from remote config (GrowthBook) where
    // TypeScript types can't help us. Coerce unknown strings to 'high'
    // rather than passing them through unchecked.
    return isEffortLevel(value) ? value : 'high'
  }
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    if (value <= 100) return 'high'
    return 'high'
  }
  return 'high'
}
export function isValidNumericEffort(value: number): boolean {
  return Number.isInteger(value)
}