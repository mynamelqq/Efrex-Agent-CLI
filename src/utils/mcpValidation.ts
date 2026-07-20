import type {
  ContentBlockParam,
  ImageBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import {
  
  roughTokenCountEstimation,
} from '../services/tokenEstimation.js'
import { compressImageBlock } from './imageResizer.js'
import { logError } from './log.js'

export const MCP_TOKEN_COUNT_THRESHOLD_FACTOR = 0.5
export const IMAGE_TOKEN_ESTIMATE = 1600
const DEFAULT_MAX_MCP_OUTPUT_TOKENS = 25000
/**
 * Resolve the MCP output token cap. Precedence:
 *   1. MAX_MCP_OUTPUT_TOKENS env var (explicit user override)
 *   2. tengu_satin_quoll GrowthBook flag's `mcp_tool` key (tokens, not chars —
 *      unlike the other keys in that map which getPersistenceThreshold reads
 *      as chars; MCP has its own truncation layer upstream of that)
 *   3. Hardcoded default
 */
export function getMaxMcpOutputTokens(): number {
  const envValue = process.env.MAX_MCP_OUTPUT_TOKENS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_MAX_MCP_OUTPUT_TOKENS
}
export type MCPToolResult = string | ContentBlockParam[] | undefined
