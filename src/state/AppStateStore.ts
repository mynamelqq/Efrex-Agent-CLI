import { DeepImmutable } from 'src/utils/messageQueueManager'
import { Store } from './store'
import { SettingsJson } from 'src/utils/settings/types'
import { getInitialSettings } from 'src/utils/settings/settings'
import { EffortValue } from '../utils/effort'
import { FileHistoryState } from 'src/utils/fileHistory'
import { PermissionMode } from 'src/types/permissions'
import type {
  MCPServerConnection,
  ServerResource,
} from '../services/mcp/types.js'
import { Command } from 'src/types/command'
import { ToolPermissionContext,getEmptyToolPermissionContext,Tool} from 'src/Tool'
import { getGlobalConfig } from 'src/utils/config'
import { ElicitationRequestEvent } from 'src/utils/elicitionHandler'
import { LoadedPlugin, PluginError } from 'src/types/plugin'
export type FooterItem =
  | 'tasks'
  | 'tmux'
  | 'bagel'
  | 'teams'
  | 'bridge'
  | 'companion'

export type AppState = DeepImmutable<{
    mainLoopModel: string,
    settings: SettingsJson,
    verbose: boolean,
    advisorModel?: string,
    // TODO (ashwin): see if we can use utility-types DeepReadonly for this
    mcp: {
      clients: MCPServerConnection[]
      tools: Tool[]
      commands: Command[]
      resources: Record<string, ServerResource[]>
      /**
       * Incremented by /reload-plugins to trigger MCP effects to re-run
       * and pick up newly-enabled plugin MCP servers. Effects read this
       * as a dependency; the value itself is not consumed.
       */
      pluginReconnectKey: number
    },
      // Auth version - incremented on login/logout to trigger re-fetching of auth-dependent data
    authVersion: number,

    inbox: {
        messages: Array<{
        id: string
        from: string
        text: string
        timestamp: string
        status: 'pending' | 'processing' | 'processed'
        color?: string
        summary?: string
        }>
    },
    // Effort value
    effortValue?: EffortValue,
    fileHistory: FileHistoryState,
    toolPermissionContext: ToolPermissionContext,
    elicitation: {
    queue: ElicitationRequestEvent[]
    },
      plugins: {
    enabled: LoadedPlugin[]
    disabled: LoadedPlugin[]
    commands: Command[]
    /**
     * Plugin system errors collected during loading and initialization.
     * See {@link PluginError} type documentation for complete details on error
     * structure, context fields, and display format.
     */
    errors: PluginError[]
    // Installation status for background plugin/marketplace installation
    installationStatus: {
      marketplaces: Array<{
        name: string
        status: 'pending' | 'installing' | 'installed' | 'failed'
        error?: string
      }>
      plugins: Array<{
        id: string
        name: string
        status: 'pending' | 'installing' | 'installed' | 'failed'
        error?: string
      }>
    }
    /**
     * Set to true when plugin state on disk has changed (background reconcile,
     * /plugin menu install, external settings edit) and active components are
     * stale. In interactive mode, user runs /reload-plugins to consume. In
     * headless mode, refreshPluginState() auto-consumes via refreshActivePlugins().
     */
    needsRefresh: boolean
  }
}>

export type AppStateStore = Store<AppState>

function getInitialModel(): string {
  const account = getGlobalConfig().oauthAccount
  const availableModels = account?.availableModels
  if (Array.isArray(availableModels) && availableModels.length > 0) {
    if (account?.selectedModel && availableModels.includes(account.selectedModel)) {
      return account.selectedModel
    }
    return availableModels[0]
  }
  return process.env.MODEL?.trim() || (getInitialSettings().model as string)
}

export function getDefaultAppState(): AppState {
  const initialMode: PermissionMode ='default'
   return {
    mainLoopModel: getInitialModel(),
    settings: getInitialSettings(),
    verbose:false,
    inbox: {
      messages: [],
    },
    authVersion:0,
    mcp: {
      clients: [],
      tools: [],
      commands: [],
      resources: {},
      pluginReconnectKey: 0,
    },
    effortValue: undefined,
    fileHistory: {//文件历史备份生命周期
      snapshots: [],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    },
    toolPermissionContext: {
      ...getEmptyToolPermissionContext(),
      mode: initialMode,
    },
    elicitation: {
      queue: [],
    },
    plugins: {
      enabled: [],
      disabled: [],
      commands: [],
      errors: [],
      installationStatus: {
        marketplaces: [],
        plugins: [],
      },
      needsRefresh: false,
    },
   }
}
