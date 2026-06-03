/**
 * Conversation clearing utility.
 * This module has heavier dependencies and should be lazy-loaded when possible.
 */
import { feature } from 'bun:bundle'
import { randomUUID, type UUID } from 'crypto'
import { setCwd } from 'src/utils/shell.js'
import {
  getLastMainRequestId,
  getOriginalCwd,
  getSessionId,
  regenerateSessionId,
  resetCostState,
  setLastAPIRequest,
  setLastAPIRequestMessages,
} from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppState.js'
import { asAgentId } from '../../types/ids.js'
import type { Message } from '../../package/message.js'
import type { FileStateCache } from '../../utils/fileStateCache.js'
import { logError } from '../../utils/log.js'
import {
  clearSessionMetadata,
  resetSessionFilePointer,
} from '../../utils/sessionStorage.js'
import { clearSessionCaches } from './cache'
import instances from '../../ink/instances.js'

export async function clearConversation({
  setMessages,
  readFileState,
  discoveredSkillNames,
  loadedNestedMemoryPaths,
  getAppState,
  setAppState,
  setConversationId,
  setCompletedTurnFooters,
  resetMainScroll,
}: {
  setMessages: (updater: (prev: Message[]) => Message[]) => void
  readFileState: FileStateCache
  discoveredSkillNames?: Set<string>
  loadedNestedMemoryPaths?: Set<string>
  getAppState?: () => AppState
  setAppState?: (f: (prev: AppState) => AppState) => void
  setConversationId?: (id: UUID) => void
  setCompletedTurnFooters?: (footers: { afterMessageCount: number; text: string }[]) => void
  resetMainScroll?: () => void
}): Promise<void> {

  // Signal to inference that this conversation's cache can be evicted.
  const lastRequestId = getLastMainRequestId()

  // Compute preserved tasks up front so their per-agent state survives the
  // cache wipe below. A task is preserved unless it explicitly has
  // isBackgrounded === false. Main-session tasks (Ctrl+B) are preserved —
  // they write to an isolated per-task transcript and run under an agent
  // context, so they're safe across session ID regeneration. See
  // LocalMainSessionTask.ts startBackgroundSession.
  const preservedAgentIds = new Set<string>()

  setMessages(() => [])
  setCompletedTurnFooters?.([])
  resetMainScroll?.()
  const ink = instances.get(process.stdout)
  ink?.invalidatePrevFrame()
  // Force logo re-render by updating conversationId
  if (setConversationId) {
    setConversationId(randomUUID())
  }

  // Clear all session-related caches. Per-agent state for preserved background
  // tasks (invoked skills, pending permission callbacks, dump state, cache-break
  // tracking) is retained so those agents keep functioning.
  clearSessionCaches(preservedAgentIds)

  // Clear large STATE-held data that outlives the message array.
  // lastAPIRequestMessages can hold the full post-compaction conversation
  // (hundreds of KB–MB) for /share; resetCostState clears modelUsage.
  setLastAPIRequest(null)
  setLastAPIRequestMessages(null)
  resetCostState()

  setCwd(getOriginalCwd())
  readFileState.clear()
  discoveredSkillNames?.clear()
  loadedNestedMemoryPaths?.clear()

  // Clean out necessary items from App State
  if (setAppState) {
    setAppState(prev => {

      return {
        ...prev,
        // Clear standalone agent context (name/color set by /rename, /color)
        // so the new session doesn't display the old session's identity badge
        standaloneAgentContext: undefined,
        fileHistory: {
          snapshots: [],
          trackedFiles: new Set(),
          snapshotSequence: 0,
        },

      }
    })
  }


  // Clear cached session metadata (title, tag, agent name/color)
  // so the new session doesn't inherit the previous session's identity
  clearSessionMetadata()
  // Generate new session ID to provide fresh state
  // Set the old session as parent for analytics lineage tracking
  regenerateSessionId({ setCurrentAsParent: true })
  await resetSessionFilePointer()

}
