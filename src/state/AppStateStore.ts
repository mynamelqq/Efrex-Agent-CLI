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
    toolPermissionContext: ToolPermissionContext
}>

export type AppStateStore = Store<AppState>
export function getDefaultAppState(): AppState {
  const initialMode: PermissionMode ='default'
   return {
    mainLoopModel: getInitialSettings().model as string,
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
   }
}
