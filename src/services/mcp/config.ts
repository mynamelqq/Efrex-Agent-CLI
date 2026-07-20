import { ConfigScope } from 'packages/mcp-client/src/types.js'
import { feature } from 'bun:bundle'
import { chmod, open, rename, stat, unlink } from 'fs/promises'
import mapValues from 'lodash/mapValues.js'
import memoize from 'lodash/memoize.js'
import { dirname, join, parse } from 'path'
import { getPlatform } from 'src/utils/platform.js'
import {
  getCurrentProjectConfig,
  getGlobalConfig,

  saveCurrentProjectConfig,

  saveGlobalConfig,
} from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { getErrnoCode } from '../../utils/errors.js'
import { safeParseJSON } from '../../utils/json.js'
import { logError } from '../../utils/log.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../../utils/settings/settings.js'

import type { ValidationError } from '../../utils/settings/validation.js'
import {
  type McpHTTPServerConfig,
  type McpJsonConfig,
  McpJsonConfigSchema,
  type McpServerConfig,
  McpServerConfigSchema,
  type McpSSEServerConfig,
  type McpStdioServerConfig,
  type McpWebSocketServerConfig,
  type ScopedMcpServerConfig,
} from './types.js'
import { getManagedFilePath } from 'src/utils/settings/mdm/managedPath.js'
import { isSettingSourceEnabled } from 'src/utils/settings/constants.js'
import { readFileSync } from 'fs'
import { expandEnvVarsInString } from './envExpansion.js'
/**
 * Get the path to the managed MCP configuration file
 */
export function getEnterpriseMcpFilePath(): string {
  return join(getManagedFilePath(), 'managed-mcp.json')
}

/**
 * Internal utility: Add scope to server configs
 */
function addScopeToServers(//对这批服务器添加范围限制
  servers: Record<string, McpServerConfig> | undefined,
  scope: ConfigScope,
): Record<string, ScopedMcpServerConfig> {
  if (!servers) {
    return {}
  }
  const scopedServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    scopedServers[name] = { ...config, scope }
  }
  return scopedServers
}
/**
 * Internal utility: Write MCP config to .mcp.json file.
 * Preserves file permissions and flushes to disk before rename.
 * Uses the original path for rename (does not follow symlinks).
 */
async function writeMcpjsonFile(config: McpJsonConfig): Promise<void> {
  const mcpJsonPath = join(getCwd(), '.mcp.json')

  // Read existing file permissions to preserve them
  let existingMode: number | undefined
  try {
    const stats = await stat(mcpJsonPath)
    existingMode = stats.mode
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
    // File doesn't exist yet -- no permissions to preserve
  }

  // Write to temp file, flush to disk, then atomic rename
  const tempPath = `${mcpJsonPath}.tmp.${process.pid}.${Date.now()}`
  const handle = await open(tempPath, 'w', existingMode ?? 0o644)
  try {
    await handle.writeFile(JSON.stringify(config, null, 2), {
      encoding: 'utf8',
    })
    await handle.datasync()
  } finally {
    await handle.close()
  }

  try {
    // Restore original file permissions on the temp file before rename
    if (existingMode !== undefined) {
      await chmod(tempPath, existingMode)
    }
    await rename(tempPath, mcpJsonPath)
  } catch (e: unknown) {
    // Clean up temp file on failure
    try {
      await unlink(tempPath)
    } catch {
      // Best-effort cleanup
    }
    throw e
  }
}

/**
 * Internal utility: Expands environment variables in an MCP server config
 */
function expandEnvVars(config: McpServerConfig): {//MCP 完整配置对象的环境变量批量解析工具 最后去重缺失变量，返回替换完成的新配置 + 缺失变量列表，上层统一校验报错
  expanded: McpServerConfig
  missingVars: string[]
} {
  const missingVars: string[] = []//环境变量占位符全部替换

  function expandString(str: string): string {
    const { expanded, missingVars: vars } = expandEnvVarsInString(str)
    missingVars.push(...vars)//加入没命中的变量名
    return expanded
  }

  let expanded: McpServerConfig

  switch (config.type) {
    case undefined:
    case 'stdio': {
      const stdioConfig = config as McpStdioServerConfig
      expanded = {//这些配置可能会有变量占位符，需要替换
        ...stdioConfig,
        command: expandString(stdioConfig.command),
        args: stdioConfig.args.map(expandString),
        env: stdioConfig.env
          ? mapValues(stdioConfig.env, expandString)
          : undefined,
      }
      break
    }
    case 'sse':
    case 'http':
    case 'ws': {
      const remoteConfig = config as
        | McpSSEServerConfig
        | McpHTTPServerConfig
        | McpWebSocketServerConfig
      expanded = {
        ...remoteConfig,
        url: expandString(remoteConfig.url),
        headers: remoteConfig.headers
          ? mapValues(remoteConfig.headers, expandString)
          : undefined,
      }
      break
    }
    case 'sse-ide':
    case 'ws-ide':
      expanded = config
      break
    case 'sdk':
      expanded = config
      break
  }

  return {
    expanded,
    missingVars: [...new Set(missingVars)],
  }
}



/**
 * Add a new MCP server configuration
 * @param name The name of the server
 * @param config The server configuration
 * @param scope The configuration scope
 * @throws Error if name is invalid or server already exists, or if the config is invalid
 */
export async function addMcpConfig(
  name: string,
  config: unknown,
  scope: ConfigScope,
): Promise<void> {
  if (name.match(/[^a-zA-Z0-9_-]/)) {
    throw new Error(
      `Invalid name ${name}. Names can only contain letters, numbers, hyphens, and underscores.`,
    )
  }

  // Validate config first (needed for command-based policy checks)
  const result = McpServerConfigSchema().safeParse(config)
  if (!result.success) {
    const formattedErrors = result.error.issues
      .map(err => `${err.path.join('.')}: ${err.message}`)
      .join(', ')
    throw new Error(`Invalid configuration: ${formattedErrors}`)
  }
  const validatedConfig = result.data

  // Check if server already exists in the target scope
  switch (scope) {//如果在当前范围内有该服务器了
    case 'project': {
      const { servers } = getProjectMcpConfigsFromCwd()//获取项目配置MCP配置
      if (servers[name]) {
        throw new Error(`MCP server ${name} already exists in .mcp.json`)
      }
      break
    }
    case 'user': {//用户的全局配置
      const globalConfig = getGlobalConfig()
      if (globalConfig.mcpServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in user config`)
      }
      break
    }
    case 'local': {
      const projectConfig = getCurrentProjectConfig()
      if (projectConfig.mcpServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in local config`)
      }
      break
    }
    case 'dynamic':
      throw new Error('Cannot add MCP server to scope: dynamic')//不能增加到动态mcp，这是项目自己配置的
  }

  // Add based on scope
  switch (scope) {//增加到目标范围配置文件
    case 'project': {
      const { servers: existingServers } = getProjectMcpConfigsFromCwd()
      const mcpServers: Record<string, McpServerConfig> = {}
      for (const [serverName, serverConfig] of Object.entries(
        existingServers,
      )) {
        const { scope: _, ...configWithoutScope } = serverConfig
        mcpServers[serverName] = configWithoutScope
      }
      mcpServers[name] = validatedConfig
      const mcpConfig = { mcpServers }

      // Write back to .mcp.json
      try {
        await writeMcpjsonFile(mcpConfig)
      } catch (error) {
        throw new Error(`Failed to write to .mcp.json: ${error}`)
      }
      break
    }

    case 'user': {
      saveGlobalConfig(current => ({
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: validatedConfig,
        },
      }))
      break
    }

    case 'local': {
      saveCurrentProjectConfig(current => ({
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: validatedConfig,
        },
      }))
      break
    }

    default:
      throw new Error(`Cannot add MCP server to scope: ${scope}`)
  }
}
/**
 * Get Claude Code MCP configurations (excludes claude.ai servers from the
 * returned set — they're fetched separately and merged by callers).
 * This is fast: only local file reads; no awaited network calls on the
 * critical path. The optional extraDedupTargets promise (e.g. the in-flight
 * claude.ai connector fetch) is awaited only after loadAllPluginsCacheOnly() completes,
 * so the two overlap rather than serialize.
 * @returns Claude Code server configurations with appropriate scopes
 */
export async function getClaudeCodeMcpConfigs(
  dynamicServers: Record<string, ScopedMcpServerConfig> = {},
  extraDedupTargets: Promise<
    Record<string, ScopedMcpServerConfig>
  > = Promise.resolve({}),
): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
  errors: PluginError[]
}> {
  // If an enterprise mcp config exists, do not use any others; this has exclusive control over all MCP servers
  // (enterprise customers often do not want their users to be able to add their own MCP servers).
  if (doesEnterpriseMcpConfigExist()) {
    // Apply policy filtering to enterprise servers
    const filtered: Record<string, ScopedMcpServerConfig> = {}

    for (const [name, serverConfig] of Object.entries(enterpriseServers)) {
      if (!isMcpServerAllowedByPolicy(name, serverConfig)) {
        continue
      }
      filtered[name] = serverConfig
    }

    return { servers: filtered, errors: [] }
  }

  // Load other scopes — unless the managed policy locks MCP to plugin-only.
  // Unlike the enterprise-exclusive block above, this keeps plugin servers.
  const mcpLocked = isRestrictedToPluginOnly('mcp')
  const noServers: { servers: Record<string, ScopedMcpServerConfig> } = {
    servers: {},
  }
  const { servers: userServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('user')
  const { servers: projectServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('project')
  const { servers: localServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('local')

  // Load plugin MCP servers
  const pluginMcpServers: Record<string, ScopedMcpServerConfig> = {}

  const pluginResult = await loadAllPluginsCacheOnly()

  // Collect MCP-specific errors during server loading
  const mcpErrors: PluginError[] = []

  // Log any plugin loading errors - NEVER silently fail in production
  if (pluginResult.errors.length > 0) {
    for (const error of pluginResult.errors) {
      // Only log as MCP error if it's actually MCP-related
      // Otherwise just log as debug since the plugin might not have MCP servers
      if (
        error.type === 'mcp-config-invalid' ||
        error.type === 'mcpb-download-failed' ||
        error.type === 'mcpb-extract-failed' ||
        error.type === 'mcpb-invalid-manifest'
      ) {
        const errorMessage = `Plugin MCP loading error - ${error.type}: ${getPluginErrorMessage(error)}`
        logError(new Error(errorMessage))
      } else {
        // Plugin doesn't exist or isn't available - this is common and not necessarily an error
        // The plugin system will handle installing it if possible
        const errorType = error.type
        logForDebugging(
          `Plugin not available for MCP: ${error.source} - error type: ${errorType}`,
        )
      }
    }
  }

  // Process enabled plugins for MCP servers in parallel
  const pluginServerResults = await Promise.all(
    pluginResult.enabled.map(plugin => getPluginMcpServers(plugin, mcpErrors)),
  )
  for (const servers of pluginServerResults) {
    if (servers) {
      Object.assign(pluginMcpServers, servers)
    }
  }

  // Add any MCP-specific errors from server loading to plugin errors
  if (mcpErrors.length > 0) {
    for (const error of mcpErrors) {
      const errorMessage = `Plugin MCP server error - ${error.type}: ${getPluginErrorMessage(error)}`
      logError(new Error(errorMessage))
    }
  }

  // Filter project servers to only include approved ones
  const approvedProjectServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(projectServers)) {
    if (getProjectMcpServerStatus(name) === 'approved') {
      approvedProjectServers[name] = config
    }
  }

  // Dedup plugin servers against manually-configured ones (and each other).
  // Plugin server keys are namespaced `plugin:x:y` so they never collide with
  // manual keys in the merge below — this content-based filter catches the case
  // where both would launch the same underlying process/connection.
  // Only servers that will actually connect are valid dedup targets — a
  // disabled manual server mustn't suppress a plugin server, or neither runs
  // (manual is skipped by name at connection time; plugin was removed here).
  const extraTargets = await extraDedupTargets
  const enabledManualServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries({
    ...userServers,
    ...approvedProjectServers,
    ...localServers,
    ...dynamicServers,
    ...extraTargets,
  })) {
    if (
      !isMcpServerDisabled(name) &&
      isMcpServerAllowedByPolicy(name, config)
    ) {
      enabledManualServers[name] = config
    }
  }
  // Split off disabled/policy-blocked plugin servers so they don't win the
  // first-plugin-wins race against an enabled duplicate — same invariant as
  // above. They're merged back after dedup so they still appear in /mcp
  // (policy filtering at the end of this function drops blocked ones).
  const enabledPluginServers: Record<string, ScopedMcpServerConfig> = {}
  const disabledPluginServers: Record<string, ScopedMcpServerConfig> = {}
  for (const [name, config] of Object.entries(pluginMcpServers)) {
    if (
      isMcpServerDisabled(name) ||
      !isMcpServerAllowedByPolicy(name, config)
    ) {
      disabledPluginServers[name] = config
    } else {
      enabledPluginServers[name] = config
    }
  }
  const { servers: dedupedPluginServers, suppressed } = dedupPluginMcpServers(
    enabledPluginServers,
    enabledManualServers,
  )
  Object.assign(dedupedPluginServers, disabledPluginServers)
  // Surface suppressions in /plugin UI. Pushed AFTER the logError loop above
  // so these don't go to the error log — they're informational, not errors.
  for (const { name, duplicateOf } of suppressed) {
    // name is "plugin:${pluginName}:${serverName}" from addPluginScopeToServers
    const parts = name.split(':')
    if (parts[0] !== 'plugin' || parts.length < 3) continue
    mcpErrors.push({
      type: 'mcp-server-suppressed-duplicate',
      source: name,
      plugin: parts[1]!,
      serverName: parts.slice(2).join(':'),
      duplicateOf,
    })
  }

  // Merge in order of precedence: plugin < user < project < local
  const configs = Object.assign(
    {},
    dedupedPluginServers,
    userServers,
    approvedProjectServers,
    localServers,
  )

  // Apply policy filtering to merged configs
  const filtered: Record<string, ScopedMcpServerConfig> = {}

  for (const [name, serverConfig] of Object.entries(configs)) {
    if (!isMcpServerAllowedByPolicy(name, serverConfig as McpServerConfig)) {
      continue
    }
    filtered[name] = serverConfig as ScopedMcpServerConfig
  }

  return { servers: filtered, errors: mcpErrors }
}
/**
 * Get all MCP configurations across all scopes, including claude.ai servers.
 * This may be slow due to network calls - use getClaudeCodeMcpConfigs() for fast startup.
 * @returns All server configurations with appropriate scopes
 */
export async function getAllMcpConfigs(): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
  errors: PluginError[]
}> {
  // Kick off the claude.ai fetch before getClaudeCodeMcpConfigs so it overlaps
  // with loadAllPluginsCacheOnly() inside. Memoized — the awaited call below is a cache hit.
  const claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
  const { servers: claudeCodeServers, errors } = await getClaudeCodeMcpConfigs(
    {},
    claudeaiPromise,
  )
  const { allowed: claudeaiMcpServers } = filterMcpServersByPolicy(
    await claudeaiPromise,
  )

  // Suppress claude.ai connectors that duplicate an enabled manual server.
  // Keys never collide (`slack` vs `claude.ai Slack`) so the merge below
  // won't catch this — need content-based dedup by URL signature.
  const { servers: dedupedClaudeAi } = dedupClaudeAiMcpServers(
    claudeaiMcpServers as Record<string, ScopedMcpServerConfig>,
    claudeCodeServers,
  )

  // Merge with claude.ai having lowest precedence
  const servers = Object.assign({}, dedupedClaudeAi, claudeCodeServers)

  return { servers, errors }
}
/**
 * Get MCP configs from current directory only (no parent traversal).
 * Used by addMcpConfig and removeMcpConfig to modify the local .mcp.json file.
 * Exported for testing purposes.
 *
 * @returns Servers with scope information and any validation errors from current directory's .mcp.json
 */
export function getProjectMcpConfigsFromCwd(): {
  servers: Record<string, ScopedMcpServerConfig>
  errors: ValidationError[]
} {
  // Check if project source is enabled
  if (!isSettingSourceEnabled('projectSettings')) {
    return { servers: {}, errors: [] }
  }

  const mcpJsonPath = join(getCwd(), '.mcp.json')//当前项目路径/.mcp.json

  const { config, errors } = parseMcpConfigFromFilePath({//读取文件获取配置对象
    filePath: mcpJsonPath,
    expandVars: true,//展开环境变量
    scope: 'project',//范围限定项目 主要用于错误展示
  })

  // Missing .mcp.json is expected, but malformed files should report errors预期存在 .mcp.json 文件，但格式错误的文件应报告错误
  if (!config) {
    const nonMissingErrors = errors.filter(
      e => !e.message.startsWith('MCP config file not found'),
    )
    if (nonMissingErrors.length > 0) {
      logForDebugging(
        `MCP config errors for ${mcpJsonPath}: ${JSON.stringify(nonMissingErrors.map(e => e.message))}`,
        { level: 'error' },
      )
      return { servers: {}, errors: nonMissingErrors }
    }
    return { servers: {}, errors: [] }
  }

  return {
    servers: config.mcpServers
      ? addScopeToServers(config.mcpServers, 'project')//如果在项目下.mcp.json读到了服务器，添加项目限制
      : {},
    errors: errors || [],
  }
}

/**
 * Get all MCP configurations from a specific scope
 * @param scope The configuration scope
 * @returns Servers with scope information and any validation errors
 */
export function getMcpConfigsByScope(
  scope: 'project' | 'user' | 'local' ,
): {
  servers: Record<string, ScopedMcpServerConfig>
  errors: ValidationError[]
} {
  // Check if this source is enabled
  const sourceMap: Record<
    string,
    'projectSettings' | 'userSettings' | 'localSettings'
  > = {
    project: 'projectSettings',
    user: 'userSettings',
    local: 'localSettings',
  }

  if (scope in sourceMap && !isSettingSourceEnabled(sourceMap[scope]!)) {
    return { servers: {}, errors: [] }
  }

  switch (scope) {
    case 'project': {//对于项目而言路径会向上找直到根目录的.mcp.json
      const allServers: Record<string, ScopedMcpServerConfig> = {}
      const allErrors: ValidationError[] = []

      // Build list of directories to check
      const dirs: string[] = []
      let currentDir = getCwd()

      while (currentDir !== parse(currentDir).root) {
        dirs.push(currentDir)
        currentDir = dirname(currentDir)
      }

      // Process from root downward to CWD (so closer files have higher priority)
      for (const dir of dirs.reverse()) {
        const mcpJsonPath = join(dir, '.mcp.json')

        const { config, errors } = parseMcpConfigFromFilePath({//读取配置
          filePath: mcpJsonPath,
          expandVars: true,
          scope: 'project',
        })

        // Missing .mcp.json in parent directories is expected, but malformed files should report errors
        if (!config) {
          const nonMissingErrors = errors.filter(
            e => !e.message.startsWith('MCP config file not found'),
          )
          if (nonMissingErrors.length > 0) {
            logForDebugging(
              `MCP config errors for ${mcpJsonPath}: ${JSON.stringify(nonMissingErrors.map(e => e.message))}`,
              { level: 'error' },
            )
            allErrors.push(...nonMissingErrors)
          }
          continue
        }

        if (config.mcpServers) {
          // Merge servers, with files closer to CWD overriding parent configs
          Object.assign(allServers, addScopeToServers(config.mcpServers, scope))
        }

        if (errors.length > 0) {
          allErrors.push(...errors)
        }
      }

      return {
        servers: allServers,
        errors: allErrors,
      }
    }
    case 'user': {//全局配置中的mcp服务器json配置
      const mcpServers = getGlobalConfig().mcpServers
      if (!mcpServers) {
        return { servers: {}, errors: [] }
      }

      const { config, errors } = parseMcpConfig({
        configObject: { mcpServers },
        expandVars: true,
        scope: 'user',
      })

      return {
        servers: addScopeToServers(config?.mcpServers, scope),
        errors,
      }
    }
    case 'local': {//项目配置的mcp服务配置
      const mcpServers = getCurrentProjectConfig().mcpServers
      if (!mcpServers) {
        return { servers: {}, errors: [] }
      }

      const { config, errors } = parseMcpConfig({
        configObject: { mcpServers },
        expandVars: true,
        scope: 'local',
      })

      return {
        servers: addScopeToServers(config?.mcpServers, scope),
        errors,
      }
    }
  }
}
/**
 * Parse and validate an MCP configuration object
 * @param params Parsing parameters
 * @returns Validated configuration with any errors
 */
export function parseMcpConfig(params: {//解析到的JSON对象，
  configObject: unknown
  expandVars: boolean
  scope: ConfigScope
  filePath?: string
}): {
  config: McpJsonConfig | null
  errors: ValidationError[]//错误列表 让用户看到全部的错误
} {
  const { configObject, expandVars, scope, filePath } = params//获取路径 范围 环境变量 配置对象
  const schemaResult = McpJsonConfigSchema().safeParse(configObject)//用MCP配置schema解析
  if (!schemaResult.success) {
    return {
      config: null,
      errors: schemaResult.error.issues.map(issue => ({
        ...(filePath && { file: filePath }),
        path: issue.path.join('.'),
        message: 'Does not adhere to MCP server configuration schema',
        mcpErrorMetadata: {
          scope,
          severity: 'fatal',
        },
      })),
    }
  }

  // Validate each server and expand variables if requested
  const errors: ValidationError[] = []
  const validatedServers: Record<string, McpServerConfig> = {}

  for (const [name, config] of Object.entries(schemaResult.data.mcpServers)) {//遍历配置文件的每一个MCP服务器配置
    let configToCheck = config

    if (expandVars) {//如果需要展开变量
      const { expanded, missingVars } = expandEnvVars(config)

      if (missingVars.length > 0) {//如果有未匹配的变量
        errors.push({
          ...(filePath && { file: filePath }),
          path: `mcpServers.${name}`,
          message: `Missing environment variables: ${missingVars.join(', ')}`,
          suggestion: `Set the following environment variables: ${missingVars.join(', ')}`,
          mcpErrorMetadata: {
            scope,
            serverName: name,
            severity: 'warning',
          },
        })
      }

      configToCheck = expanded
    }

    // Check for Windows-specific npx usage without cmd wrapper测 Windows 平台下一种常见踩坑配置 直接把 command 设为 npx 启动子进程，不套 cmd /c 包装器会执行失败；
    if (
      getPlatform() === 'windows' &&
      (!configToCheck.type || configToCheck.type === 'stdio') &&
      'command' in configToCheck &&
      (configToCheck.command === 'npx' ||
        configToCheck.command.endsWith('\\npx') ||
        configToCheck.command.endsWith('/npx'))
    ) {
      errors.push({
        ...(filePath && { file: filePath }),
        path: `mcpServers.${name}`,
        message: `Windows requires 'cmd /c' wrapper to execute npx`,
        suggestion: `Change command to "cmd" with args ["/c", "npx", ...]. See: https://code.claude.com/docs/en/mcp#configure-mcp-servers`,
        mcpErrorMetadata: {
          scope,
          serverName: name,
          severity: 'warning',
        },
      })
    }

    validatedServers[name] = configToCheck
  }
  return {
    config: { mcpServers: validatedServers },
    errors,
  }
}
/**
 * Parse and validate an MCP configuration from a file path
 * @param params Parsing parameters
 * @returns Validated configuration with any errors
 */
export function parseMcpConfigFromFilePath(params: {//解析并验证MCP配置文件
  filePath: string
  expandVars: boolean
  scope: ConfigScope
}): {
  config: McpJsonConfig | null
  errors: ValidationError[]
} {
  const { filePath, expandVars, scope } = params
  let configContent: string
  try {
    configContent = readFileSync(filePath, { encoding: 'utf8' })//配置内容
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {//没找到文件
      return {
        config: null,
        errors: [
          {
            file: filePath,
            path: '',
            message: `MCP config file not found: ${filePath}`,
            suggestion: 'Check that the file path is correct',
            mcpErrorMetadata: {
              scope,
              severity: 'fatal',
            },
          },
        ],
      }
    }
    logForDebugging(
      `MCP config read error for ${filePath} (scope=${scope}): ${error}`,
      { level: 'error' },
    )
    return {
      config: null,
      errors: [
        {
          file: filePath,
          path: '',
          message: `Failed to read file: ${error}`,
          suggestion: 'Check file permissions and ensure the file exists',
          mcpErrorMetadata: {
            scope,
            severity: 'fatal',
          },
        },
      ],
    }
  }

  const parsedJson = safeParseJSON(configContent)//安全解析JSON文件

  if (!parsedJson) {
    logForDebugging(
      `MCP config is not valid JSON: ${filePath} (scope=${scope}, length=${configContent.length}, first100=${JSON.stringify(configContent.slice(0, 100))})`,
      { level: 'error' },
    )
    return {
      config: null,
      errors: [
        {
          file: filePath,
          path: '',
          message: `MCP config is not a valid JSON`,
          suggestion: 'Fix the JSON syntax errors in the file',
          mcpErrorMetadata: {
            scope,
            severity: 'fatal',
          },
        },
      ],
    }
  }

  return parseMcpConfig({
    configObject: parsedJson,
    expandVars,
    scope,
    filePath,
  })
}


