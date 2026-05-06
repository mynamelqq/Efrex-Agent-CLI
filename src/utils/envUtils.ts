import memoize from 'lodash/memoize'
import { homedir } from 'os'
import { join } from 'path'

// Memoized: 150+ callers, many on hot paths. Keyed off Efrex_CONFIG_DIR so
// tests that change the env var get a fresh value without explicit cache.clear.
export const getEfrexConfigHomeDir = memoize(
  (): string => {
    return (
      process.env.Efrex_CONFIG_DIR ?? join(homedir(), '.efrex')
    ).normalize('NFC')
  },
  () => process.env.Efrex_CONFIG_DIR,
)



/**
 * Get the AWS region with fallback to default
 * Matches the Anthropic Bedrock SDK's region behavior
 */
export function getAWSRegion(): string {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
}

/**
 * Get the default Vertex AI region
 */
export function getDefaultVertexRegion(): string {
  return process.env.CLOUD_ML_REGION || 'us-east5'
}

export function isEnvTruthy(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

export function isEnvDefinedFalsy(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }

  return ['0', 'false', 'no', 'off', ''].includes(value.toLowerCase())
}

export const getClaudeConfigHomeDir = getEfrexConfigHomeDir
