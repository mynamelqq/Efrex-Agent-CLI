import { DeepImmutable } from '../types/utils'
import { Store } from './store'
import { SettingsJson } from 'src/utils/settings/types'
import { getInitialSettings } from 'src/utils/settings/settings'
import { EffortValue } from '../utils/effort'
import { FileHistoryState } from 'src/utils/fileHistory'
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
    advisorModel?: string,
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
    fileHistory: FileHistoryState
}>

export type AppStateStore = Store<AppState>
export function getDefaultAppState(): AppState {
   return {
    mainLoopModel: "",
    settings: getInitialSettings(),
    inbox: {
      messages: [],
    },
    effortValue: undefined,
    fileHistory: {//文件历史备份生命周期
      snapshots: [],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    },

   }
}
