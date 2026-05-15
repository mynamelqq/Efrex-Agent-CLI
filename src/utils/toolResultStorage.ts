
import type { Message } from 'src/package/message.js'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { ToolResultBlockParam } from 'src/package/message.js'
import { getErrnoCode, toError } from './errors.js'
import { formatFileSize } from './format.js'
import { logError } from './log.js'
import { getToolResultsDir } from './sessionStorage.js'
import { logForDebugging } from './debug.js'
import type { Tool } from 'src/Tool.js'
import { DEFAULT_MAX_RESULT_SIZE_CHARS, MAX_TOOL_RESULT_BYTES } from 'src/constants/toolLimits.js'
/**
 * 聚合工具结果预算的每个对话线程状态。
 * 状态必须稳定才能保留提示缓存：
 *   -sawIds：已通过预算检查的结果（替换为
 *     或没有）。一旦看到，结果的命运就被冻结了。
 *   -替换：已保存到磁盘的 sawId 的子集以及
 *     替换为预览，映射到显示的确切预览字符串
 *     模型。重新应用是一次映射查找——保证无文件 I/O
 *     字节相同，不能失败。
 *
 * 生命周期：每个会话线程一个实例，由 ToolUseContext 承载。
 * 主线程：REPL 规定一次，永不重置——之后的陈旧条目
 * /clear、rewind、resume 或 compact 永远不会被查找（tool_use_ids 是
 * UUID），因此它们是无害的。子代理：createSubagentContext 克隆
 * 默认情况下父级的状态（像agentSummary这样的缓存共享分叉需要
 * 相同的决定），或resumeAgentBackground线程一重建
 * 来自侧链记录。
 */
export type ContentReplacementState = {
  seenIds: Set<string>
  replacements: Map<string, string>
}
// Result of persisting a tool result to disk
export type PersistedToolResult = {
  filepath: string
  originalSize: number
  isJson: boolean
  preview: string
  hasMore: boolean
}

// Error result when persistence fails
export type PersistToolResultError = {
  error: string
}
type ToolResultCandidate = {
  toolUseId: string
  content: NonNullable<ToolResultBlockParam['content']>
  size: number
}

type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content?: NonNullable<ToolResultBlockParam['content']>
}

type ToolUseBlockLike = {
  type: 'tool_use'
  id: string
  name: string
}

type CandidatePartition = {
  mustReapply: Array<ToolResultCandidate & { replacement: string }>
  frozen: ToolResultCandidate[]
  fresh: ToolResultCandidate[]
}
export type ToolResultReplacementRecord = Extract<
  ContentReplacementRecord,
  { kind: 'tool-result' }
>
/**
 * 一个内容替换决策的可序列化记录。写给
 * 转录作为 ContentReplacementEntry，以便决策在简历中保留。
 * 通过“种类”进行区分，因此未来的替换机制（用户文本，
 * 卸载的图像）可以共享相同的转录条目类型。
 *
 * `replacement` 是模型看到的确切字符串 -存储而不是
 * 派生于简历，因此代码更改为预览模板、尺寸格式、
 * 或者路径布局无法默默地破坏提示缓存。
 */
export type ContentReplacementRecord = {
  kind: 'tool-result'
  toolUseId: string
  replacement: string
}
// XML tag used to wrap persisted output messages
export const PERSISTED_OUTPUT_TAG = '<persisted-output>'
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'
export async function applyToolResultBudget(
  messages: Message[],
  state: ContentReplacementState | undefined,
  writeToTranscript?: (records: ToolResultReplacementRecord[]) => void,
  skipToolNames?: ReadonlySet<string>,
): Promise<Message[]> {
  if (!state) return messages
  const result = await enforceToolResultBudget(messages, state, skipToolNames)
  if (result.newlyReplaced.length > 0) {
    writeToTranscript?.(result.newlyReplaced)
  }
  return result.messages
}
// Preview size in bytes for the reference message
export const PREVIEW_SIZE_BYTES = 2000
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000
/**
 * 根据聚合工具结果大小强制执行每条消息的预算。
 *
 * 对于每个 tool_result 块一起超过的用户消息
 * 每条消息限制（参见 getPerMessageBudgetLimit），最大 FRESH
 * （以前从未见过）该消息的结果被保存到磁盘上并且
 * 替换为预览。
 * 消息是独立评估的——一条消息中包含 150K 个结果，
 * 另一个 150K 的结果既低于预算又未受影响。
 *
 * 状态由“state”中的 tool_use_id 跟踪。一旦看到结果
 * 命运被冻结：先前替换的结果得到相同的替换
 * 每轮都重新应用缓存的预览字符串（零 I/O，
 * 字节相同），并且以前未替换的结果永远不会被替换
 * 稍后（会破坏提示缓存）。
 *
 * 每回合最多添加一条带有 tool_result 块的新用户消息，
 * 因此，每个消息循环通常最多执行一次预算检查；
 * 所有先前的消息只是重新应用缓存的替换。
 *
 * @param state — MUTATED：seenIds 和替换内容已就地更新
 *   记录进行此调用的选择。调用者持有稳定的引用
 *   跨越转弯；返回一个新对象将需要容易出错的引用
 *   每次查询后都会更新。
 *
 * 返回“{ messages, newReplaced }”：
 *   -消息：不需要替换时的相同数组实例
 *   -新替换：替换进行此调用（不重新应用）。
 *     调用者将这些保留到记录中以进行恢复重建。
 */
export async function enforceToolResultBudget(
  messages: Message[],
  state: ContentReplacementState,
  skipToolNames: ReadonlySet<string> = new Set(),
): Promise<{
  messages: Message[]
  newlyReplaced: ToolResultReplacementRecord[]
}> {
  // 按消息收集所有 tool_result 候选块（聚合属于同一用户消息的所有结果）
  const candidatesByMessage = collectCandidatesByMessage(messages)
  
  // 构建 tool_use_id 到工具名称的映射（仅在需要跳过某些工具时）
  const nameByToolUseId =
    skipToolNames.size > 0 ? buildToolNameMap(messages) : undefined
  
  // 判断指定 ID 的工具结果是否应该被跳过（不进行预算检查）
  const shouldSkip = (id: string): boolean =>
    nameByToolUseId !== undefined &&
    skipToolNames.has(nameByToolUseId.get(id) ?? '')
  
  // 解析每条消息的预算限制（在调用期间固定，避免中途变化影响缓存）
  const limit = MAX_TOOL_RESULTS_PER_MESSAGE_CHARS

  // 存储需要替换的 tool_use_id -> 替换内容
  const replacementMap = new Map<string, string>()
  // 需要持久化到磁盘的候选结果（超过预算的）
  const toPersist: ToolResultCandidate[] = []
  let reappliedCount = 0      // 重新应用的替换数量（统计用）
  let messagesOverBudget = 0  // 超过预算的消息数量（统计用）

  // 逐条消息处理（每条消息独立评估预算）
  for (const candidates of candidatesByMessage) {
    // 将当前消息的候选结果分为三类：
    // - mustReapply: 之前已替换，需要重新应用相同的替换内容
    // - frozen: 之前已决定保留（未替换），直接原样使用
    // - fresh: 首次见到的新结果，需要评估是否超预算
    const { mustReapply, frozen, fresh } = partitionByPriorDecision(//三个状态的数组
      candidates,
      state,
    )

    // 重新应用：纯 Map 查找，无文件 I/O，字节完全相同，不会失败
    mustReapply.forEach(c => replacementMap.set(c.toolUseId, c.replacement))//循环然后
    reappliedCount += mustReapply.length//重新应用的数量加上

    // fresh 为空表示这是已处理过的消息（所有 ID 都已在 seenIds 中）
    if (fresh.length === 0) {
      // 保持不变量：确保所有 ID 都标记为已见（重新添加是空操作）
      candidates.forEach(c => state.seenIds.add(c.toolUseId))
      continue
    }
    //fresh不为空有新工具使用记录
    // 处理需要跳过的工具（maxResultSizeChars: Infinity）
    // 这些工具永远不会被持久化，直接标记为已见（冻结决策）
    const skipped = fresh.filter(c => shouldSkip(c.toolUseId))
    skipped.forEach(c => state.seenIds.add(c.toolUseId))
    
    // 真正需要评估预算的候选结果（排除跳过的工具）
    const eligible = fresh.filter(c => !shouldSkip(c.toolUseId))

    // 计算已冻结内容的总大小 + 新内容的总大小
    const frozenSize = frozen.reduce((sum, c) => sum + c.size, 0)
    const freshSize = eligible.reduce((sum, c) => sum + c.size, 0)

    // 判断是否超过预算，选择需要替换的候选结果
    const selected =//返回选中要替换的结果
      frozenSize + freshSize > limit//加起来总大小超了
        ? selectFreshToReplace(eligible, frozenSize, limit)
        : []

    // 关键：先标记不持久化的结果为“已见”（同步执行）
    // 这确保没有读取者会在 sawIds 中看到某个 ID，但不会替换中
    // 否则会导致误判为冻结而发送完整内容，造成服务器故障
    const selectedIds = new Set(selected.map(c => c.toolUseId))
    candidates
      .filter(c => !selectedIds.has(c.toolUseId))
      .forEach(c => state.seenIds.add(c.toolUseId))

    // 如果没有需要替换的候选，继续处理下一条消息
    if (selected.length === 0) continue
    
    messagesOverBudget++
    toPersist.push(...selected)//添加到持久化列表
  }

  // 既没有需要重新应用的内容，也没有需要持久化的新内容
  if (replacementMap.size === 0 && toPersist.length === 0) {
    return { messages, newlyReplaced: [] }
  }

  // 并发持久化所有选中的候选结果（实际场景中通常只来自单条消息）
  const freshReplacements = await Promise.all(
    toPersist.map(async c => [c, await buildReplacement(c)] as const),
  )
  
  const newlyReplaced: ToolResultReplacementRecord[] = []
  let replacedSize = 0
  
  // 处理持久化结果，更新状态
  for (const [candidate, replacement] of freshReplacements) {
    // 在持久化完成后标记为已见，与 replacements.set 原子化配对
    // 对于持久化失败的情况（replacement === null），ID 标记为已见但未替换
    // 原始内容已发送给模型，因此后续将其视为 frozen 是正确的
    state.seenIds.add(candidate.toolUseId)
    
    if (replacement === null) continue  // 持久化失败，跳过
    
    replacedSize += candidate.size
    replacementMap.set(candidate.toolUseId, replacement.content)
    state.replacements.set(candidate.toolUseId, replacement.content)
    newlyReplaced.push({
      kind: 'tool-result',
      toolUseId: candidate.toolUseId,
      replacement: replacement.content,
    })
  }

  // 没有成功生成任何替换内容
  if (replacementMap.size === 0) {
    return { messages, newlyReplaced: [] }
  }

  // 返回替换后的消息列表和新生成的替换记录
  return {
    messages: replaceToolResultContents(messages, replacementMap),
    newlyReplaced,
  }
}
/**
 * Return a new Message[] where each tool_result block whose id appears in
 * replacementMap has its content replaced. Messages and blocks with no
 * replacements are passed through by reference.
 */
function replaceToolResultContents(
  messages: Message[],
  replacementMap: Map<string, string>,
): Message[] {
  return messages.map(message => {
    if (message.type !== 'user' || !Array.isArray(message.message!.content)) {
      return message
    }
    const content = message.message!.content
    const needsReplace = content.some(
      (block): block is ToolResultBlock =>
        isToolResultBlock(block) && replacementMap.has(block.tool_use_id),
    )
    if (!needsReplace) return message
    return {
      ...message,
      message: {
        ...message.message,
        content: content.map(block => {
          if (!isToolResultBlock(block)) return block
          const replacement = replacementMap.get(block.tool_use_id)
          return replacement === undefined
            ? block
            : { ...block, content: replacement }
        }),
      },
    } as Message
  })
}

/**
 * 遍历消息并从助手 tool_use 构建 tool_use_id → tool_name
 * 块。 tool_use 始终先于其 tool_result（模型调用，然后结果
 * 到达），所以当预算执行部门看到结果时，它的名字就已经知道了。
 */
function buildToolNameMap(messages: Message[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const content = message.message!.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (isToolUseBlock(block)) {
        map.set(block.id, block.name)
      }
    }
  }
  return map
}

function collectCandidatesByMessage(
  messages: Message[],
): ToolResultCandidate[][] {
  const groups: ToolResultCandidate[][] = []//二维数组，每个子数组包含来自同一用户消息的候选项
  let current: ToolResultCandidate[] = []
  const flush = () => {//在遇到助手消息时刷新当前候选组，确保每组只包含来自同一用户消息的结果
    if (current.length > 0) groups.push(current)
    current = []
  }
  const seenAsstIds = new Set<string>()
  for (const message of messages) {
    if (message.type === 'user') {
      current.push(...collectCandidatesFromMessage(message))
    } else if (message.type === 'assistant') {//遇到助手消息，刷新
      const assistantMessageId = String(message.message?.id ?? '')
      if (!seenAsstIds.has(assistantMessageId)) {
        flush()
        seenAsstIds.add(assistantMessageId)
      }
    }
  }
  flush()

  return groups
}
function collectCandidatesFromMessage(message: Message): ToolResultCandidate[] {//收集单条消息中的所有 tool_result 块作为候选项
  if (message.type !== 'user' || !Array.isArray(message.message!.content)) {
    return []
  }
  return message.message!.content.flatMap(block => {
    if (!isToolResultBlock(block) || !block.content) return []//toolResult
    const toolResultBlock = block as ToolResultBlock
    const content = toolResultBlock.content as NonNullable<
      ToolResultBlockParam['content']
    >
    return [
      {
        toolUseId: toolResultBlock.tool_use_id,
        content,//内容
        size: contentSize(content),//大小
      },
    ]
  })
}
function contentSize(
  content: NonNullable<ToolResultBlockParam['content']>,
): number {
  if (typeof content === 'string') return content.length
  // 直接对文本块长度求和。与序列化相比，计数略有不足
  // （没有 JSON 框架），但预算无论如何都是一个粗略的令牌启发式。
  // 避免每次强制执行都分配内容大小的字符串。
  return content.reduce(
    (sum, b) => sum + (b.type === 'text' ? b.text.length : 0),
    0,
  )
}

function isToolResultBlock(block: unknown): block is ToolResultBlock {
  return (
    !!block &&
    typeof block === 'object' &&
    (block as { type?: unknown }).type === 'tool_result' &&
    typeof (block as { tool_use_id?: unknown }).tool_use_id === 'string'
  )
}

function isToolUseBlock(block: unknown): block is ToolUseBlockLike {
  return (
    !!block &&
    typeof block === 'object' &&
    (block as { type?: unknown }).type === 'tool_use' &&
    typeof (block as { id?: unknown }).id === 'string' &&
    typeof (block as { name?: unknown }).name === 'string'
  )
}
/**
 * Partition candidates by their prior decision state:
 *  - mustReapply: previously replaced → re-apply the cached replacement for
 *    prefix stability之前已经替换过的工具调用。必须重新应用  目的：保证前缀稳定，不破坏缓存。
 *  - frozen: previously seen and left unreplaced → off-limits (replacing
 *    now would change a prefix that was already cached)冻结，不能碰之前见过，但当时选择不替换。
现在绝对不能再处理 / 替换。
原因：一动就会破坏已经缓存的前缀内容。
 *  - fresh: never seen → eligible for new replacement decisions 全新，可处理 从来没见过的新工具调用。
 */
function partitionByPriorDecision(
  candidates: ToolResultCandidate[],
  state: ContentReplacementState,
): CandidatePartition {
  return candidates.reduce<CandidatePartition>(
    (acc, c) => {
      const replacement = state.replacements.get(c.toolUseId)
      if (replacement !== undefined) {
        acc.mustReapply.push({ ...c, replacement })
      } else if (state.seenIds.has(c.toolUseId)) {
        acc.frozen.push(c)
      } else {
        acc.fresh.push(c)
      }
      return acc
    },
    { mustReapply: [], frozen: [], fresh: [] },
  )
}

/**
 * Pick the largest fresh results to replace until the model-visible total
 * (frozen + remaining fresh) is at or under budget, or fresh is exhausted.
 * If frozen results alone exceed budget we accept the overage — microcompact
 * will eventually clear them.
 */
function selectFreshToReplace(
  fresh: ToolResultCandidate[],
  frozenSize: number,//冻结是必须要原样保留的所以只传数字，fresh可以替换
  limit: number,
): ToolResultCandidate[] {
  const sorted = [...fresh].sort((a, b) => b.size - a.size)//从大到小排序，优先替换大的
  const selected: ToolResultCandidate[] = []
  let remaining = frozenSize + fresh.reduce((sum, c) => sum + c.size, 0)//总大小
  for (const c of sorted) {
    if (remaining <= limit) break
    selected.push(c)
    // We don't know the replacement size until after persist, but previews
    // are ~2K and results hitting this path are much larger, so subtracting
    // the full size is a close approximation for selection purposes.
    remaining -= c.size
  }
  return selected
}
async function buildReplacement(
  candidate: ToolResultCandidate,
): Promise<{ content: string; originalSize: number } | null> {
  const result = await persistToolResult(candidate.content, candidate.toolUseId)//持久化
  if (isPersistError(result)) return null
  return {
    content: buildLargeToolResultMessage(result),
    originalSize: result.originalSize,
  }
}
/**
 * Build a message for large tool results with preview
 */
export function buildLargeToolResultMessage(
  result: PersistedToolResult,
): string {
  let message = `${PERSISTED_OUTPUT_TAG}\n`
  message += `Output too large (${formatFileSize(result.originalSize)}). Full output saved to: ${result.filepath}\n\n`
  message += `Preview (first ${formatFileSize(PREVIEW_SIZE_BYTES)}):\n`
  message += result.preview
  message += result.hasMore ? '\n...\n' : '\n'
  message += PERSISTED_OUTPUT_CLOSING_TAG
  return message
}
/**
 * Type guard to check if persist result is an error
 */
export function isPersistError(
  result: PersistedToolResult | PersistToolResultError,
): result is PersistToolResultError {
  return 'error' in result
}
/**
 * Persist a tool result to disk and return information about the persisted file
 *
 * @param content - The tool result content to persist (string or array of content blocks)
 * @param toolUseId - The ID of the tool use that produced the result
 * @returns Information about the persisted file including filepath and preview
 */
export async function persistToolResult(//重点：持久化工具结果
  content: NonNullable<ToolResultBlockParam['content']>,
  toolUseId: string,
): Promise<PersistedToolResult | PersistToolResultError> {
  const isJson = Array.isArray(content)

  // Check for non-text content - we can only persist text blocks
  if (isJson) {
    const hasNonTextContent = content.some(block => block.type !== 'text')//有一些不是文本块
    if (hasNonTextContent) {
      return {
        error: 'Cannot persist tool results containing non-text content',
      }
    }
  }

  await ensureToolResultsDir()
  const filepath = getToolResultPath(toolUseId, isJson)
  const contentStr = isJson ? JSON.stringify(content, null, 2) : content

  // tool_use_id is unique per invocation and content is deterministic for a
  // given id, so skip if the file already exists. This prevents re-writing
  // the same content on every API turn when microcompact replays the
  // original messages. Use 'wx' instead of a stat-then-write race.
  try {
    await writeFile(filepath, contentStr, { encoding: 'utf-8', flag: 'wx' })//写文件，如果文件已存在则失败，模式为“wx”确保原子性，避免竞争条件
    logForDebugging(
      `Persisted tool result to ${filepath} (${formatFileSize(contentStr.length)})`,
    )
  } catch (error) {
    if (getErrnoCode(error) !== 'EEXIST') {
      logError(toError(error))
      return { error: getFileSystemErrorMessage(toError(error)) }
    }
    // EEXIST: already persisted on a prior turn, fall through to preview
  }

  // Generate a preview
  const { preview, hasMore } = generatePreview(contentStr, PREVIEW_SIZE_BYTES)

  return {
    filepath,
    originalSize: contentStr.length,
    isJson,
    preview,
    hasMore,
  }
}

/**
 * Ensure the session-specific tool results directory exists
 */
export async function ensureToolResultsDir(): Promise<void> {
  try {
    await mkdir(getToolResultsDir(), { recursive: true })
  } catch {
    // Directory may already exist
  }
}

/**
 * Generate a preview of content, truncating at a newline boundary when possible.
 */
export function generatePreview(//预览
  content: string,
  maxBytes: number,
): { preview: string; hasMore: boolean } {
  if (content.length <= maxBytes) {
    return { preview: content, hasMore: false }
  }

  // Find the last newline within the limit to avoid cutting mid-line
  const truncated = content.slice(0, maxBytes)//截取前面最大的字符数
  const lastNewline = truncated.lastIndexOf('\n')

  // If we found a newline reasonably close to the limit, use it
  // Otherwise fall back to the exact limit
  const cutPoint = lastNewline > maxBytes * 0.5 ? lastNewline : maxBytes//最后一行的索引大于一半那就可以裁掉，否则不裁剪，会影响信息完整性

  return { preview: content.slice(0, cutPoint), hasMore: true }
}

/**
 * Get the filepath where a tool result would be persisted.
 */
export function getToolResultPath(id: string, isJson: boolean): string {
  const ext = isJson ? 'json' : 'txt'
  return join(getToolResultsDir(), `${id}.${ext}`)
}
/**
 * Get a human-readable error message from a filesystem error
 */
function getFileSystemErrorMessage(error: Error): string {
  // Node.js filesystem errors have a 'code' property
  // eslint-disable-next-line no-restricted-syntax -- uses .path, not just .code
  const nodeError = error as NodeJS.ErrnoException
  if (nodeError.code) {
    switch (nodeError.code) {
      case 'ENOENT':
        return `Directory not found: ${nodeError.path ?? 'unknown path'}`
      case 'EACCES':
        return `Permission denied: ${nodeError.path ?? 'unknown path'}`
      case 'ENOSPC':
        return 'No space left on device'
      case 'EROFS':
        return 'Read-only file system'
      case 'EMFILE':
        return 'Too many open files'
      case 'EEXIST':
        return `File already exists: ${nodeError.path ?? 'unknown path'}`
      default:
        return `${nodeError.code}: ${nodeError.message}`
    }
  }
  return error.message
}
// 处理大型工具结果时，将其保存到磁盘而非进行截断操作。  如果无需保存，则返回原始块；否则返回经过修改的块，其中内容已被替换为指向已保存文件的引用。
export async function maybePersistLargeToolResult(
  toolResultBlock: ToolResultBlockParam,
  toolName: string,
  persistenceThreshold?: number,//阈值
): Promise<ToolResultBlockParam> {
  // Check size first before doing any async work - most tool results are small
  const content = toolResultBlock.content
  // inc-4586: Empty tool_result content at the prompt tail causes some models
  // (notably capybara) to emit the \n\nHuman: stop sequence and end their turn
  // with zero output. The server renderer inserts no \n\nAssistant: marker after
  // tool results, so a bare </function_results>\n\n pattern-matches to a turn
  // boundary. Several tools can legitimately produce empty output (silent-success
  // shell commands, MCP servers returning content:[], REPL statements, etc.).
  // Inject a short marker so the model always has something to react to.
  if (isToolResultContentEmpty(content)) {
    return {
      ...toolResultBlock,
      content: `(${toolName} completed with no output)`,
    }
  }
  // Narrow after the emptiness guard — content is non-nullish past this point.
  if (!content) {
    return toolResultBlock
  }


  const size = contentSize(content)

  // Use tool-specific threshold if provided, otherwise fall back to global limit
  const threshold = persistenceThreshold ?? MAX_TOOL_RESULT_BYTES
  if (size <= threshold) {
    return toolResultBlock
  }

  // Persist the entire content as a unit
  const result = await persistToolResult(content, toolResultBlock.tool_use_id)//
  if (isPersistError(result)) {
    // If persistence failed, return the original block unchanged
    return toolResultBlock
  }

  const message = buildLargeToolResultMessage(result)


  return { ...toolResultBlock, content: message }
}
/**
 * True when a tool_result's content is empty or effectively empty. Covers:
 * undefined/null/'', whitespace-only strings, empty arrays, and arrays whose
 * only blocks are text blocks with empty/whitespace text. Non-text blocks
 * (images, tool_reference) are treated as non-empty.
 */
export function isToolResultContentEmpty(
  content: ToolResultBlockParam['content'],
): boolean {
  if (!content) return true
  if (typeof content === 'string') return content.trim() === ''
  if (!Array.isArray(content)) return false
  if (content.length === 0) return true
  return content.every(
    block =>
      typeof block === 'object' &&
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      (typeof block.text !== 'string' || block.text.trim() === ''),
  )
}
export function getPersistenceThreshold(
  toolName: string,
  declaredMaxResultSizeChars: number,
): number {
  // Infinity = hard opt-out (reserved for tools that self-bound via other
  // mechanisms). Checked before the GB override so tengu_satin_quoll can't
  // force it back on.
  if (!Number.isFinite(declaredMaxResultSizeChars)) {
    return declaredMaxResultSizeChars
  }
  return Math.min(declaredMaxResultSizeChars, DEFAULT_MAX_RESULT_SIZE_CHARS)
}
