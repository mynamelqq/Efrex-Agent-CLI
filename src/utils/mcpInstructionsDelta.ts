import type {
  ConnectedMCPServer,
  MCPServerConnection,
} from '../services/mcp/types.js'
import type { Message } from 'src/package/message.js'
import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'
// MCP（Model Context Protocol）服务可以在对话中途随时连接 / 断开。
// 旧方案：用 DANGEROUS_uncachedSystemPromptSection，每一轮对话都重新渲染全部 MCP 指令。只要有服务器晚接入，整个 System Prompt 缓存直接失效，性能很差。
// 本文件实现新方案：增量 Delta 机制
// 不再把全部 MCP 指令塞在静态 system prompt 里；而是通过对话附件（attachment）增量推送变更，让系统提示分片可以稳定缓存，不用每轮重算。
// 这是 MCP 服务指令增量下发模块，配套你上一段 systemPromptSection 缓存体系，用来解决 MCP 服务器动态上下线导致系统提示词频繁失效、缓存频繁击穿的痛点。
export type McpInstructionsDelta = {
  /** Server names — for stateless-scan reconstruction. */
  addedNames: string[]
  /** Rendered "## {name}\n{instructions}" blocks for addedNames. */
  addedBlocks: string[]
  removedNames: string[]
}

/**
 * True → announce MCP server instructions via persisted delta attachments.
 * False → prompts.ts keeps its DANGEROUS_uncachedSystemPromptSection
 * (rebuilt every turn; cache-busts on late connect).
 *
 * Env override for local testing: CLAUDE_CODE_MCP_INSTR_DELTA=true/false
 * wins over both ant bypass and the GrowthBook gate.
 */
export function isMcpInstructionsDeltaEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)) return true
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_MCP_INSTR_DELTA)) return false
  return (
    process.env.USER_TYPE === 'ant'
  )
}





