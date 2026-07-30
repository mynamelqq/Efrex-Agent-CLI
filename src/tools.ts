// Type for any schema that outputs an object with string keys
import { GlobTool } from './tools/GlobTool/GlobTool'
import { Tool, ToolPermissionContext, Tools } from './Tool'
import { FileReadTool } from './tools/FileReadTool/FileReadTool'
import { GrepTool } from './tools/GrepTool/GrepTool'
import { BashTool } from './tools/BashTool/BashTool'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool'
import { FileEditTool } from './tools/FileEditTool/FileEditTool'
import { isEnvTruthy } from './utils/envUtils'
import { uniqBy } from 'lodash'
export function getAllBaseTools():Tools{
    return [
        BashTool,
        //PowerShellTool
        GlobTool,GrepTool,FileEditTool,FileReadTool,FileWriteTool
    ]//GlobTool,GrepTool,FileReadTool,FileEditTool,BashTool,,WebSearchTool,FileWriteTool
}
export type ShellProgress = any
export type BashProgress = any

/**
 * 可以与 --tools 标志一起使用的预定义工具预设
 */
export const TOOL_PRESETS = ['default'] as const

export type ToolPreset = (typeof TOOL_PRESETS)[number]
export function parseToolPreset(preset: string): ToolPreset | null {
  const presetString = preset.toLowerCase()
  if (!TOOL_PRESETS.includes(presetString as ToolPreset)) {//如果有default存在
    return null
  }
  return presetString as ToolPreset
}

/**
 * Get the list of tool names for a given preset
 * Filters out tools that are disabled via isEnabled() check
 * @param preset The preset name
 * @returns Array of tool names
 */
export function getToolsForDefaultPreset(): string[] {
  const tools = getAllBaseTools()
  const isEnabled = tools.map(tool => tool.isEnabled())
  return tools.filter((_, i) => isEnabled[i]).map(tool => tool.name)
}
/**
 * Filters out tools that are blanket-denied by the permission context.
 * A tool is filtered out if there's a deny rule matching its name with no
 * ruleContent (i.e., a blanket deny for that tool).
 *
 * Uses the same matcher as the runtime permission check (step 1a), so MCP
 * server-prefix rules like `mcp__server` strip all tools from that server
 * before the model sees them — not just at call time.
 */
export function filterToolsByDenyRules<
  T extends {
    name: string
    mcpInfo?: { serverName: string; toolName: string }
  },
>(tools:  T[], permissionContext: ToolPermissionContext): T[] {
  return tools
}
export const getTools = (permissionContext: ToolPermissionContext): Tools => {

  // Get all base tools and filter out special tools that get added conditionally
//   const specialTools = new Set([
//     // ListMcpResourcesTool.name,
//     // ReadMcpResourceTool.name,
//     // SYNTHETIC_OUTPUT_TOOL_NAME,
//   ])

  const tools = getAllBaseTools()

  // Filter out tools that are denied by the deny rules
//   let allowedTools = filterToolsByDenyRules(tools, permissionContext)

  const isEnabled =tools.map(_ => _.isEnabled())
  return tools.filter((_, i) => isEnabled[i])
}

/**
 * 为给定的权限上下文和 MCP 工具组装完整的工具池。
 *
 * 这是将内置工具与 MCP 工具相结合的唯一事实来源。
 * REPL.tsx（通过 useMergedTools 挂钩）和 runAgent.ts（对于协调器工作人员）都使用此函数来确保一致的工具池组装。
 *
 * 功能：
 * 1.通过getTools()获取内置工具（尊重模式过滤）
 * 2.通过拒绝规则过滤MCP工具
 * 3、按工具名称去重（内置工具优先）
 *
 * @param permissionContext -用于过滤内置工具的权限上下文
 * @param mcpTools -来自 appState.mcp.tools 的 MCP 工具
 * @returns 内置和 MCP 工具的组合、重复数据删除阵列
 */
export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)

  // Filter out MCP tools that are in the deny list
  const allowedMcpTools = [...mcpTools]

  // Sort each partition for prompt-cache stability, keeping built-ins as a
  // contiguous prefix. The server's claude_code_system_cache_policy places a
  // global cache breakpoint after the last prefix-matched built-in tool; a flat
  // sort would interleave MCP tools into built-ins and invalidate all downstream
  // cache keys whenever an MCP tool sorts between existing built-ins. uniqBy
  // preserves insertion order, so built-ins win on name conflict.
  // Avoid Array.toSorted (Node 20+) — we support Node 18. builtInTools is
  // readonly so copy-then-sort; allowedMcpTools is a fresh .filter() result.
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
}
/**
 * Get all tools including both built-in tools and MCP tools.
 *
 * This is the preferred function when you need the complete tools list for:
 * - Tool search threshold calculations (isToolSearchEnabled)
 * - Token counting that includes MCP tools
 * - Any context where MCP tools should be considered
 *
 * Use getTools() only when you specifically need just built-in tools.
 *
 * @param permissionContext - Permission context for filtering built-in tools
 * @param mcpTools - MCP tools from appState.mcp.tools
 * @returns Combined array of built-in and MCP tools
 */
export function getMergedTools(//合并工具和mcp工具
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)
  return [...builtInTools, ...mcpTools]
}
