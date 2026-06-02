import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { relative } from 'path'
import { getCwd } from 'src/utils/cwd.js'
import { TranscriptMessage } from '../types/logs.js'
import { asSessionId } from '../types/ids.js'
import { loadMessageLogs,getSessionIdFromLog } from './sessionStorage.js'
import type {
  AttributionSnapshotMessage,
  ContextCollapseCommitEntry,
  ContextCollapseSnapshotEntry,
  LogOption,
  SerializedMessage,
} from '../types/logs.js'
import type {
  Message,
  NormalizedMessage,
  NormalizedUserMessage,
} from '../package/message.js'
import { PERMISSION_MODES } from '../types/permissions.js'
import {

  type FileHistorySnapshot,
} from './fileHistory.js'
import { logError } from './log.js'
import {
  createAssistantMessage,
  createUserMessage,
  filterOrphanedThinkingOnlyMessages,
  filterUnresolvedToolUses,
  NO_RESPONSE_REQUESTED,
  filterWhitespaceOnlyAssistantMessages
  ,normalizeMessages,isToolUseResultMessage
} from './messages.js'
import {
  isLiteLog,

  loadFullLog,

  loadTranscriptFile,

} from './sessionStorage.js'
import type { ContentReplacementRecord } from './toolResultStorage.js'
import { validateUuid } from './sessionStoragePortable.js'

export type TurnInterruptionState =
  | { kind: 'none' }
  | { kind: 'interrupted_prompt'; message: NormalizedUserMessage }

export type DeserializeResult = {
  messages: Message[]
  turnInterruptionState: TurnInterruptionState
}
/**
 * Internal 3-way result from detection, before transforming interrupted_turn
 * into interrupted_prompt with a synthetic continuation message.
 */
type InternalInterruptionState =
  | TurnInterruptionState
  | { kind: 'interrupted_turn' }


/**
 * Is this tool_result the output of a tool that legitimately terminates a
 * turn? SendUserMessage is the canonical case: in brief mode, calling it is
 * the turn's final act — there is no follow-up assistant text (#20467
 * removed it). A transcript ending here means the turn COMPLETED, not that
 * it was killed mid-tool.
 *
 * Walks back to find the assistant tool_use that this result belongs to and
 * checks its name. The matching tool_use is typically the immediately
 * preceding relevant message (filterUnresolvedToolUses has already dropped
 * unpaired ones), but we walk just in case system/progress noise is
 * interleaved.
 */
function isTerminalToolResult(
  result: NormalizedUserMessage,
  messages: NormalizedMessage[],
  resultIdx: number,
): boolean {
  const content = result.message.content
  if (!Array.isArray(content)) return false
  const block = content[0]
  if (block?.type !== 'tool_result') return false
  const toolUseId = block.tool_use_id

  for (let i = resultIdx - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.type !== 'assistant') continue
    const msgContent = msg.message!.content
    if (!Array.isArray(msgContent)) continue
    for (const b of msgContent) {
      if (
        typeof b !== 'string' &&
        'type' in b &&
        b.type === 'tool_use' &&
        'id' in b &&
        b.id === toolUseId
      ) {
        return (
        false
        )
      }
    }
  }
  return false
}

/**
 * Determines whether the conversation was interrupted mid-turn based on the
 * last message after filtering. An assistant as last message (after filtering
 * unresolved tool_uses) is treated as a completed turn because stop_reason is
 * always null on persisted messages in the streaming path.
 *
 * System and progress messages are skipped when finding the last turn-relevant
 * message — they are bookkeeping artifacts that should not mask a genuine
 * interruption. Attachments are kept as part of the turn.
 */
function detectTurnInterruption(
  messages: NormalizedMessage[],
): InternalInterruptionState {
  if (messages.length === 0) {
    return { kind: 'none' }
  }

  // Find the last turn-relevant message, skipping system/progress and
  // synthetic API error assistants. Error assistants are already filtered
  // before API send (normalizeMessagesForAPI) — skipping them here lets
  // auto-resume fire after retry exhaustion instead of reading the error as
  // a completed turn.
  const lastMessageIdx = messages.findLastIndex(
    m =>
      m.type !== 'system' &&
      m.type !== 'progress' &&
      !(m.type === 'assistant' && m.isApiErrorMessage),
  )
  const lastMessage =
    lastMessageIdx !== -1 ? messages[lastMessageIdx] : undefined

  if (!lastMessage) {
    return { kind: 'none' }
  }

  if (lastMessage.type === 'assistant') {
    // In the streaming path, stop_reason is always null on persisted messages
    // because messages are recorded at content_block_stop time, before
    // message_delta delivers the stop_reason. After filterUnresolvedToolUses
    // has removed assistant messages with unmatched tool_uses, an assistant as
    // the last message means the turn most likely completed normally.
    return { kind: 'none' }
  }

  if (lastMessage.type === 'user') {
    if (lastMessage.isMeta || lastMessage.isCompactSummary) {
      return { kind: 'none' }
    }
    if (isToolUseResultMessage(lastMessage)) {
      // Brief mode (#20467) drops the trailing assistant text block, so a
      // completed brief-mode turn legitimately ends on SendUserMessage's
      // tool_result. Without this check, resume misclassifies every
      // brief-mode session as interrupted mid-turn and injects a phantom
      // "Continue from where you left off." before the user's real next
      // prompt. Look back one step for the originating tool_use.
      if (isTerminalToolResult(lastMessage, messages, lastMessageIdx)) {
        return { kind: 'none' }
      }
      return { kind: 'interrupted_turn' }
    }
    // Plain text user prompt — CC hadn't started responding
    return {
      kind: 'interrupted_prompt',
      message: lastMessage as NormalizedUserMessage,
    }
  }

  if (lastMessage.type === 'attachment') {
    // Attachments are part of the user turn — the user provided context but
    // the assistant never responded.
    return { kind: 'interrupted_turn' }
  }

  return { kind: 'none' }
}
  /**
 * Deserializes messages from a log file into the format expected by the REPL.
 * Filters unresolved tool uses, orphaned thinking messages, and appends a
 * synthetic assistant sentinel when the last message is from the user.
 * @internal Exported for testing - use loadConversationForResume instead
 */
export function deserializeMessages(serializedMessages: Message[]): Message[] {
  return deserializeMessagesWithInterruptDetection(serializedMessages).messages
}

/**
 * Like deserializeMessages, but also detects whether the session was
 * interrupted mid-turn. Used by the SDK resume path to auto-continue
 * interrupted turns after a gateway-triggered restart.
 * @internal Exported for testing
 */
export function deserializeMessagesWithInterruptDetection(
  serializedMessages: Message[],
): DeserializeResult {
  try {
    // 在处理之前对旧版附件类型进行转换
    const migratedMessages = serializedMessages.map(
      migrateLegacyAttachmentTypes,
    )

// 剔除已反序列化的用户消息中无效的权限模式值。 // 此字段为来自磁盘的未经验证的 JSON 数据，可能包含来自不同版本的模式。
    const validModes = new Set<string>(PERMISSION_MODES)
    for (const msg of migratedMessages) {
      if (
        msg.type === 'user' &&
        msg.permissionMode !== undefined &&
        !validModes.has(msg.permissionMode as string)
      ) {
        msg.permissionMode = undefined
      }
    }

    // 过滤掉未解决的工具使用情况以及其后的任何自动生成的消息
    const filteredToolUses = filterUnresolvedToolUses(
      migratedMessages,
    ) as NormalizedMessage[]

// 过滤掉那些仅包含思考内容且会导致 API 错误的孤立辅助信息消息。
// 这些错误通常在重新开始时出现。它们是因为流式传输会为每个内容块生成单独的消息，而用户消息的交错排列使得通过 message.id 来进行正确合并变得无法实现。
    const filteredThinking = filterOrphanedThinkingOnlyMessages(
      filteredToolUses,
    ) as NormalizedMessage[]

    // Filter out assistant messages with only whitespace text content.
    // This can happen when model outputs "\n\n" before thinking, user cancels mid-stream.
    const filteredMessages = filterWhitespaceOnlyAssistantMessages(
      filteredThinking,
    ) as NormalizedMessage[]

    const internalState = detectTurnInterruption(filteredMessages)

    // Transform mid-turn interruptions into interrupted_prompt by appending
    // a synthetic continuation message. This unifies both interruption kinds
    // so the consumer only needs to handle interrupted_prompt.
    let turnInterruptionState: TurnInterruptionState
    if (internalState.kind === 'interrupted_turn') {
      const [continuationMessage] = normalizeMessages([
        createUserMessage({
          content: 'Continue from where you left off.',
          isMeta: true,
        }),
      ])
      filteredMessages.push(continuationMessage!)
      turnInterruptionState = {
        kind: 'interrupted_prompt',
        message: continuationMessage!,
      }
    } else {
      turnInterruptionState = internalState
    }

    // Append a synthetic assistant sentinel after the last user message so
    // the conversation is API-valid if no resume action is taken. Skip past
    // trailing system/progress messages and insert right after the user
    // message so removeInterruptedMessage's splice(idx, 2) removes the
    // correct pair.
    const lastRelevantIdx = filteredMessages.findLastIndex(
      m => m.type !== 'system' && m.type !== 'progress',
    )
    if (
      lastRelevantIdx !== -1 &&
      filteredMessages[lastRelevantIdx]!.type === 'user'
    ) {
      filteredMessages.splice(
        lastRelevantIdx + 1,
        0,
        createAssistantMessage({
          content: NO_RESPONSE_REQUESTED,
        }) as NormalizedMessage,
      )
    }

    return { messages: filteredMessages, turnInterruptionState }
  } catch (error) {
    logError(error as Error)
    throw error
  }
}
/**
 * Transforms legacy attachment types to current types for backward compatibility
 */
function migrateLegacyAttachmentTypes(message: Message): Message {
  if (message.type !== 'attachment') {
    return message
  }

  const attachment = message.attachment as {
    type: string
    [key: string]: unknown
  } // Handle legacy types not in current type system

  // Transform legacy attachment types
  if (attachment.type === 'new_file') {
    return {
      ...message,
      attachment: {
        ...attachment,
        type: 'file',
        displayPath: relative(getCwd(), attachment.filename as string),
      },
    } as unknown as SerializedMessage // Cast entire message since we know the structure is correct
  }

  if (attachment.type === 'new_directory') {
    return {
      ...message,
      attachment: {
        ...attachment,
        type: 'directory',
        displayPath: relative(getCwd(), attachment.path as string),
      },
    } as unknown as SerializedMessage // Cast entire message since we know the structure is correct
  }

  // Backfill displayPath for attachments from old sessions
  if (!('displayPath' in attachment)) {
    const path =
      'filename' in attachment
        ? (attachment.filename as string)
        : 'path' in attachment
          ? (attachment.path as string)
          : 'skillDir' in attachment
            ? (attachment.skillDir as string)
            : undefined
    if (path) {
      return {
        ...message,
        attachment: {
          ...attachment,
          displayPath: relative(getCwd(), path),
        },
      } as unknown as Message
    }
  }

  return message
}
export function removeExtraFields(
  transcript: TranscriptMessage[],
): SerializedMessage[] {
  return transcript.map(m => {
    const { isSidechain, parentUuid, ...serializedMessage } = m
    return serializedMessage
  })
}
/**
 * Chain-walk a transcript jsonl by path.  Same sequence loadFullLog
 * runs internally — loadTranscriptFile → find newest non-sidechain
 * leaf → buildConversationChain → removeExtraFields — just starting
 * from an arbitrary path instead of the sid-derived one.
 *
 * leafUuids is populated by loadTranscriptFile as "uuids that no
 * other message's parentUuid points at" — the chain tips.  There can
 * be several (sidechains, orphans); newest non-sidechain is the main
 * conversation's end.
 */
export async function loadMessagesFromJsonlPath(path: string): Promise<{
  messages: SerializedMessage[]
  sessionId: UUID | undefined
}> {
  const { messages: byUuid, leafUuids } = await loadTranscriptFile(path)
  let tip: (typeof byUuid extends Map<UUID, infer T> ? T : never) | null = null
  let tipTs = 0
  for (const m of byUuid.values()) {
    if (m.isSidechain || !leafUuids.has(m.uuid)) continue
    const ts = new Date(m.timestamp).getTime()
    if (ts > tipTs) {
      tipTs = ts
      tip = m
    }
  }
  if (!tip) return { messages: [], sessionId: undefined }
  const chain = buildConversationChain(byUuid, tip)
  return {
    messages: removeExtraFields(chain),
    // Leaf's sessionId — forked sessions copy chain[0] from the source
    // transcript, so the root retains the source session's ID. Matches
    // loadFullLog's mostRecentLeaf.sessionId.
    sessionId: tip.sessionId as UUID | undefined,
  }
}
/**

从各种来源加载用于恢复的对话。
这是用于加载和反序列化对话的集中函数。
@param source - 要加载的来源：
undefined：加载最近的对话
string：要加载的会话 ID
LogOption：已加载的对话
@param sourceJsonlFile - 可选参数：指向对话记录 jsonl 文件的路径。
当 --resume 接收到一个 .jsonl 路径时使用（cli/print.ts 根据后缀进行路由），
通常用于跨目录恢复，即对话记录位于当前项目目录之外的情况。
@returns 包含反序列化后的消息和原始日志的对象，如果未找到则返回 null
*/


export async function loadConversationForResume(
  source: string | LogOption | undefined,
  sourceJsonlFile: string | undefined,
): Promise<{
  messages: Message[]
  turnInterruptionState: TurnInterruptionState
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contentReplacements?: ContentReplacementRecord[]
  contextCollapseCommits?: ContextCollapseCommitEntry[]
  contextCollapseSnapshot?: ContextCollapseSnapshotEntry
  sessionId: UUID | undefined
  // Session metadata for restoring agent context
  agentName?: string
  agentColor?: string
  agentSetting?: string
  customTitle?: string
  tag?: string
  mode?: 'coordinator' | 'normal'
  prNumber?: number
  prUrl?: string
  prRepository?: string
  // Full path to the session file (for cross-directory resume)
  fullPath?: string
} | null> {
  try {
    let log: LogOption | null = null
    let messages: Message[] | null = null
    let sessionId: UUID | undefined

    if (source === undefined) {//--continue 
      // --continue: most recent session, skipping live --bg/daemon sessions
      // that are actively writing their own transcript.
      const logsPromise = loadMessageLogs()//先加载项目会话日志
      let skip = new Set<string>()
      const logs = await logsPromise
      log =
        logs.find(l => {
          const id = getSessionIdFromLog(l)//获取sessionId
          return !id || !skip.has(id)
        }) ?? null
    } else if (sourceJsonlFile) {//有提供jsonl路径
      const loaded = await loadMessagesFromJsonlPath(sourceJsonlFile)
      messages = loaded.messages
      sessionId = loaded.sessionId
    } else if (typeof source === 'string') {//如果是会话UUID
      const targetSessionId = validateUuid(source)
      if (!targetSessionId) {
        return null
      }
      const logs = await loadMessageLogs()
      log =
        logs.find(candidate => {
          const id = getSessionIdFromLog(candidate)
          return id === targetSessionId
        }) ?? null
      sessionId = targetSessionId
    } else {
      log = source
    }
    if (!log && !messages) {
      return null
    }
    if (log) {
      // Load full messages for lite logs
      if (isLiteLog(log)) {//如果加载的是精简日志
        log = await loadFullLog(log)//那么加载全部日志
      }

      // Determine sessionId first so we can pass it to copy functions
      if (!sessionId) {
        sessionId = getSessionIdFromLog(log) as UUID
      }
      // Copy file history for resume
      // void copyFileHistoryForResume(log)

      messages = log.messages
    }

    //  Restore skill state from invoked_skills attachments before deserialization.
    //  This ensures skills survive multiple compaction cycles after resume.
    // restoreSkillStateFromMessages(messages!)

    // Deserialize messages to handle unresolved tool uses and ensure proper format
    const deserialized = deserializeMessagesWithInterruptDetection(messages!)
    messages = deserialized.messages

    //  Process session start hooks for resume
    // const hookMessages = await processSessionStartHooks('resume', { sessionId })

    //  Append hook messages to the conversation
    // messages.push(...hookMessages)

    return {
      messages,
      turnInterruptionState: deserialized.turnInterruptionState,
      fileHistorySnapshots: log?.fileHistorySnapshots,
      attributionSnapshots: log?.attributionSnapshots,
      contentReplacements: log?.contentReplacements,
      contextCollapseCommits: log?.contextCollapseCommits,
      contextCollapseSnapshot: log?.contextCollapseSnapshot,
      sessionId,
      // Include session metadata for restoring agent context on resume
      agentName: log?.agentName,
      agentColor: log?.agentColor,
      agentSetting: log?.agentSetting,
      customTitle: log?.customTitle,
      tag: log?.tag,
      mode: log?.mode,
      prNumber: log?.prNumber,
      prUrl: log?.prUrl,
      prRepository: log?.prRepository,
      // Include full path for cross-directory resume
      fullPath: log?.fullPath,
    }
  } catch (error) {
    logError(error as Error)
    throw error
  }
}
/**
 * Builds a conversation chain from a leaf message to root
 * @param messages Map of all messages
 * @param leafMessage The leaf message to start from
 * @returns Array of messages from root to leaf
 */
export function buildConversationChain(//从叶子节点向上找
  messages: Map<UUID, TranscriptMessage>,
  leafMessage: TranscriptMessage,
): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = []//已见的数组添加到这里
  const seen = new Set<UUID>()
  let currentMsg: TranscriptMessage | undefined = leafMessage//先从叶子开始
  while (currentMsg) {
    if (seen.has(currentMsg.uuid)) {//如果已见了，说明成环了
      logError(
        new Error(
          `Cycle detected in parentUuid chain at message ${currentMsg.uuid}. Returning partial transcript.`,
        ),
      )
      break
    }
    seen.add(currentMsg.uuid)//已见
    transcript.push(currentMsg)
    currentMsg = currentMsg.parentUuid//访问父节点
      ? messages.get(currentMsg.parentUuid)
      : undefined
  }
  transcript.reverse()//反转
  return recoverOrphanedParallelToolResults(messages, transcript, seen)//回复并行的工具调用
}
/**
 * Post-pass for buildConversationChain: recover sibling assistant blocks and
 * tool_results that the single-parent walk orphaned.
 *
 * Streaming (claude.ts:~2024) emits one AssistantMessage per content_block_stop
 * — N parallel tool_uses → N messages, distinct uuid, same message.id. Each
 * tool_result's sourceToolAssistantUUID points to its own one-block assistant,
 * so insertMessageChain's override (line ~894) writes each TR's parentUuid to a
 * DIFFERENT assistant. The topology is a DAG; the walk above is a linked-list
 * traversal and keeps only one branch.
 *
 * Two loss modes observed in production (both fixed here):
 *   1. Sibling assistant orphaned: walk goes prev→asstA→TR_A→next, drops asstB
 *      (same message.id, chained off asstA) and TR_B.
 *   2. Progress-fork (legacy, pre-#23537): each tool_use asst had a progress
 *      child (continued the write chain) AND a TR child. Walk followed
 *      progress; TRs were dropped. No longer written (progress removed from
 *      transcript persistence), but old transcripts still have this shape.
 *
 * Read-side fix: the write topology is already on disk for old transcripts;
 * this recovery pass handles them.
 */
function recoverOrphanedParallelToolResults(//后处理修复函数，用来解决并行工具调用时消息链断裂的问题一次请求返回 N 个并行 tool_use
  //每个 tool_use 对应一个独立的 assistant 消息块（不同 uuid，但相同 message.id）每个工具结果（TR）指向自己的 assistant 父节点
  messages: Map<UUID, TranscriptMessage>,
  chain: TranscriptMessage[],//经过重建的数组
  seen: Set<UUID>,
): TranscriptMessage[] {
  type ChainAssistant = TranscriptMessage & { type: 'assistant' }
  const chainAssistants = chain.filter(
    (m): m is ChainAssistant => m.type === 'assistant',//过滤成只有助手消息
  )
  if (chainAssistants.length === 0) return chain

  // Anchor = last on-chain member of each sibling group. chainAssistants is
  // already in chain order, so later iterations overwrite → last wins.
  const anchorByMsgId = new Map<string, ChainAssistant>()
  for (const a of chainAssistants) {
    if (a.message!.id) anchorByMsgId.set(a.message!.id, a)//每个 message.id 组在链上的最后一个成员（作为插入锚点）
  }

  // O(n) precompute: sibling groups and TR index.
  // TRs indexed by parentUuid — insertMessageChain:~894 already wrote that
  // as the srcUUID, and --fork-session strips srcUUID but keeps parentUuid.
  const siblingsByMsgId = new Map<string, TranscriptMessage[]>()//按 message.id 分组的所有 assistant（找到链外的兄弟）
  const toolResultsByAsst = new Map<UUID, TranscriptMessage[]>()//按 parentUuid 索引的所有工具结果（找到链外的 TR）
  for (const m of messages.values()) {
    if (m.type === 'assistant' && m.message!.id) {//如果是助手消息,找id相同的兄弟
      const group = siblingsByMsgId.get(m.message!.id)
      if (group) group.push(m)
      else siblingsByMsgId.set(m.message!.id, [m])
    } else if (//如果是用户消息找工具结果
      m.type === 'user' &&
      m.parentUuid &&
      Array.isArray(m.message!.content) &&
      (m.message!.content as Array<{ type: string }>).some(
        b => b.type === 'tool_result',
      )
    ) {
      const group = toolResultsByAsst.get(m.parentUuid)
      if (group) group.push(m)
      else toolResultsByAsst.set(m.parentUuid, [m])
    }
  }

  // For each message.id group touching the chain: collect off-chain siblings,
  // then off-chain TRs for ALL members. Splice right after the last on-chain
  // member so the group stays contiguous for normalizeMessagesForAPI's merge
  // and every TR lands after its tool_use.
  const processedGroups = new Set<string>()
  const inserts = new Map<UUID, TranscriptMessage[]>()
  let recoveredCount = 0
  for (const asst of chainAssistants) {
    const msgId = asst.message!.id
    if (!msgId || processedGroups.has(msgId)) continue
    processedGroups.add(msgId)

    const group = siblingsByMsgId.get(msgId) ?? [asst]
    const orphanedSiblings = group.filter(s => !seen.has(s.uuid))
    const orphanedTRs: TranscriptMessage[] = []
    for (const member of group) {
      const trs = toolResultsByAsst.get(member.uuid)
      if (!trs) continue
      for (const tr of trs) {
        if (!seen.has(tr.uuid)) orphanedTRs.push(tr)
      }
    }
    if (orphanedSiblings.length === 0 && orphanedTRs.length === 0) continue

    // Timestamp sort keeps content-block / completion order; stable-sort
    // preserves JSONL write order on ties.
    orphanedSiblings.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    orphanedTRs.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    const anchor = anchorByMsgId.get(msgId)!
    const recovered = [...orphanedSiblings, ...orphanedTRs]
    for (const r of recovered) seen.add(r.uuid)
    recoveredCount += recovered.length
    inserts.set(anchor.uuid, recovered)
  }

  if (recoveredCount === 0) return chain


  const result: TranscriptMessage[] = []
  for (const m of chain) {
    result.push(m)
    const toInsert = inserts.get(m.uuid)
    if (toInsert) result.push(...toInsert)
  }
  return result
}
