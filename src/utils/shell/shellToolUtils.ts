import { BASH_TOOL_NAME}from "src/tools/BashTool/toolName.js";
import {POWERSHELL_TOOL_NAME} from "src/tools/PowerShellTool/toolName.js";
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getPlatform } from '../platform.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

/** * PowerShellTool 的运行时权限控制。仅限 Windows 系统（权限引擎使用 Windows 特定的路径规范化方式）。默认开启（通过环境变量设置为 0 表示开启）；
 * 外部默认关闭（通过环境变量设置为 1 表示开启）。 * * 该控制机制被 tools.ts（工具列表可见性）、
 * processBashCommand（路由处理）以及 promptShellExecution（技能前置路由）所使用，
 * 以便在调用 PowerShellTool.call() 的所有路径中保持权限控制的一致性。 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  return true
}
