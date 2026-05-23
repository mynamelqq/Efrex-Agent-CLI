import { ReasoningEffort } from "openai/resources";
import { getInitialSettings } from "./settings/settings";
export type  { ReasoningEffort}
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh'

export const EFFORT_LEVELS = [
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

export function getEffortEnvOverride(): EffortValue | null | undefined {
  const envOverride = process.env.EFFORT_LEVEL
  return envOverride?.toLowerCase() === 'unset' ||
    envOverride?.toLowerCase() === 'auto'
    ? null
    : parseEffortValue(envOverride)
}

export function getEffortValueDescription(value: EffortValue): string {
  if (typeof value === 'number') {
    return `Numeric effort value of ${value}`
  }

  switch (value) {
    case 'low':
      return 'Quick, straightforward implementation with minimal overhead'
    case 'medium':
      return 'Balanced approach with standard implementation and testing'
    case 'high':
      return 'Comprehensive implementation with extensive testing and documentation'
    case 'xhigh':
      return 'Extended reasoning beyond high'
    default:
      return 'Balanced approach with standard implementation and testing'
  }
}

/**
 * Numeric values are model-default only and not persisted.
 * 'max' is session-scoped for external users (ants can persist it).
 * Write sites call this before saving to settings so the Zod schema
 * (which only accepts string levels) never rejects a write.
 */
export function toPersistableEffort(
  value: EffortValue | undefined,
): EffortLevel | undefined {
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  ) {
    return value
  }

  return undefined
}
export function getInitialEffortSetting(): EffortLevel | undefined {
  // toPersistableEffort filters 'max' for non-ants on read, so a manually
  // edited settings.json doesn't leak session-scoped max into a fresh session.
  return toPersistableEffort(getInitialSettings().effortLevel)
}