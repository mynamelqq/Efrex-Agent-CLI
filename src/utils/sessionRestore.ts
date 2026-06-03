import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { dirname } from 'path'
import {
  getSessionId,
  setOriginalCwd,switchSession
} from '../bootstrap/state.js'
import type { AppState } from '../state/AppState.js'
import type { Message } from '../package/message.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import type { FileHistorySnapshot } from './fileHistory.js'
import { createSystemMessage } from './messages.js'
import { asSessionId } from '../types/ids.js'
import type {
  AttributionSnapshotMessage,
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
} from '../types/logs.js'
import {
    restoreSessionMetadata,
    adoptResumedSessionFile,resetSessionFilePointer
} from './sessionStorage.js'
// 会话恢复编排层 — 负责将 `sessionStorage.ts` 加载的原始数据转化为可渲染的 `AppState`，
// 包括 session ID 切换、agent 恢复、worktree 恢复、元数据写回等。是 `--continue`/`--resume` 流程的"总装车间"。
import type { ContentReplacementRecord } from './toolResultStorage.js'
type ResumeResult = {
  messages?: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contextCollapseCommits?: ContextCollapseCommitEntry[]
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry
}
/**
 * Result of processing a resumed/continued conversation for rendering.
 */
export type ProcessedResume = {
  messages: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  contentReplacements?: ContentReplacementRecord[]
  agentName: string | undefined
  initialState: AppState
}

/**
 * Subset of the coordinator mode module API needed for session resume.
 */
type CoordinatorModeApi = {
  matchSessionMode(mode?: string): string | undefined
  isCoordinatorMode(): boolean
}

/**
 * The loaded conversation data (return type of loadConversationForResume).
 */
type ResumeLoadResult = {//加载会话数据的结果
  messages: Message[]
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contentReplacements?: ContentReplacementRecord[]
  contextCollapseCommits?: ContextCollapseCommitEntry[]
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry
  sessionId: UUID | undefined
  agentName?: string
  agentColor?: string
  agentSetting?: string
  customTitle?: string
  tag?: string
  mode?: 'coordinator' | 'normal'
  prNumber?: number
  prUrl?: string
  prRepository?: string
}

/**
 * Process a loaded conversation for resume/continue.
 *
 * Handles coordinator mode matching, session ID setup, agent restoration,
 * mode persistence, and initial state computation. Called by both --continue
 * and --resume paths in main.tsx.
 */
export async function processResumedConversation(//处理恢复的会话数据
  result: ResumeLoadResult,
  opts: {

    sessionIdOverride?: string
    transcriptPath?: string
    includeAttribution?: boolean
  },
  context: {
    currentCwd: string
    initialState: AppState
  },
): Promise<ProcessedResume> {
  // Match coordinator/normal mode to the resumed session
  let modeWarning: string | undefined
  // Reuse the resumed session's ID unless --fork-session is specified
    const sid = opts.sessionIdOverride ?? result.sessionId
    if (sid) {
        // When resuming from a different project directory (git worktrees,
        // cross-project), transcriptPath points to the actual file; its dirname
        // is the project dir. Otherwise the session lives in the current project.
        switchSession(
        asSessionId(sid),
        opts.transcriptPath ? dirname(opts.transcriptPath) : null,
        )
        // Rename asciicast recording to match the resumed session ID so
        // getSessionRecordingPaths() can discover it during /share
    //   await renameRecordingForSession()
        await resetSessionFilePointer()
    //   restoreCostStateForSession(sid)
    }

  // Restore session metadata so /status shows the saved name and metadata
  // is re-appended on session exit. Fork doesn't take ownership of the
  // original session's worktree — a "Remove" on the fork's exit dialog
  // would delete a worktree the original session still references — so
  // strip worktreeSession from the fork path so the cache stays unset.
  restoreSessionMetadata(
    result,
  )
    // Point sessionFile at the resumed transcript and re-append metadata
    // now. resetSessionFilePointer above nulled it (so the old fresh-session
    // path doesn't leak), but that blocks reAppendSessionMetadata — which
    // bails on null — from running in the exit cleanup handler. For fork,
    // useLogMessages populates a *new* file via recordTranscript on REPL
    // mount; the normal lazy-materialize path is correct there.
  adoptResumedSessionFile()
  // Compute initial state before render (per CLAUDE.md guidelines)
  const restoredAttribution =  undefined
  const restoredSnapshots = result.fileHistorySnapshots ?? []
  const restoredTrackedFiles =
    restoredSnapshots.length > 0
      ? new Set(
          Object.keys(
            restoredSnapshots[restoredSnapshots.length - 1]!
              .trackedFileBackups,
          ),
        )
      : context.initialState.fileHistory.trackedFiles

  return {
    messages: result.messages,
    fileHistorySnapshots: result.fileHistorySnapshots,
    contentReplacements: result.contentReplacements,
    agentName: result.agentName,
    initialState: {
      ...context.initialState,
      fileHistory: {
        snapshots: restoredSnapshots,
        trackedFiles: restoredTrackedFiles,
        snapshotSequence:
          restoredSnapshots.length > 0
            ? restoredSnapshots.length
            : context.initialState.fileHistory.snapshotSequence,
      },
    //   ...(restoredAttribution && { attribution: restoredAttribution }),
    },
  }
}
/**
 * Restore session state (file history, attribution, todos) from log on resume.
 * Used by both SDK (print.ts) and interactive (REPL.tsx, main.tsx) resume paths.
 */
export function restoreSessionStateFromLog(
  result: ResumeResult,
  setAppState: (f: (prev: AppState) => AppState) => void,
): void {
  // Restore file history state
  // if (result.fileHistorySnapshots && result.fileHistorySnapshots.length > 0) {
  //   fileHistoryRestoreStateFromLog(result.fileHistorySnapshots, newState => {
  //     setAppState(prev => ({ ...prev, fileHistory: newState }))
  //   })
  // }

}