/**
 * Shared utilities for expanding environment variables in MCP server configurations
 */

/**
 * Expand environment variables in a string value
 * Handles ${VAR} and ${VAR:-default} syntax
 * @returns Object with expanded string and list of missing variables
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {//解析字符串里的环境变量占位符 ${VAR} / ${VAR:-默认值}，自动替换系统环境变量
  const missingVars: string[] = []//存放不存在、且没有默认兜底值的环境变量名，上层可据此抛出配置错误

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {//替换完环境变量后的完整字符串
    // Split on :- to support default values (limit to 2 parts to preserve :- in defaults)
    const [varName, defaultValue] = varContent.split(':-', 2)
    const envValue = process.env[varName]//检查环境变量有无变量名 否则返回默认值

    if (envValue !== undefined) {
      return envValue
    }
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Track missing variable for error reporting
    missingVars.push(varName)
    // Return original if not found (allows debugging but will be reported as error)
    return match
  })

  return {
    expanded,
    missingVars,
  }
}
