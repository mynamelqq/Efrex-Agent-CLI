import { DeepImmutable } from '../types/utils'
import { Store } from './store'
import { EffortValue } from '../utils/effort'
export type FooterItem =
  | 'tasks'
  | 'tmux'
  | 'bagel'
  | 'teams'
  | 'bridge'
  | 'companion'

export type AppState = DeepImmutable<{
    mainLoopModel: "",
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

}>

export type AppStateStore = Store<AppState>
export function getDefaultAppState(): AppState {
   return {
    mainLoopModel: "",
    inbox: {
      messages: [],
    },
    effortValue: undefined,

   }
}
