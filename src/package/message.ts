import type {
  ContentBlockParam,
  ContentBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
export type{ContentBlockParam, ContentBlock} from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionContentPartRefusal,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions'
import type { CompletionUsage } from 'openai/resources'
import { BetaCacheCreation, BetaIterationsUsage, BetaServerToolUsage } from 'src/types/message'
export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'attachment'
  | 'progress'
  | 'tool_use_summary'
  | 'tombstone'
  | 'grouped_tool_use'
  | 'collapsed_read_search'
export type HookResultMessage = Message
export type BetaTool = {
  name: string
  description: string
  input_schema: Record<string, unknown>
  defer_loading?: boolean
}
export type RenderableMessage =
  | AssistantMessage
  | UserMessage
  | (import('@ant/model-provider').Message & { type: 'system' })
  | (import('@ant/model-provider').Message & {
      type: 'attachment'
      attachment: {
        type: string
        memories?: { path: string; content: string; mtimeMs: number }[]
        [key: string]: unknown
      }
    })
  | (import('@ant/model-provider').Message & { type: 'progress' })
  | import('@ant/model-provider').GroupedToolUseMessage
export type BetaToolUnion = BetaTool
export interface ToolResultBlockParam {
  tool_use_id: string;
  type: 'tool_result';
  content?:
    | string
    | Array<any>;
  is_error?: boolean;
}
export type ContentItem =
  | ChatCompletionContentPart
  | ChatCompletionContentPartRefusal

export type MessageContent = ChatCompletionMessageParam['content']| Array<Record<string, unknown>>|ContentBlock[]|ContentBlockParam[]
export interface ToolUseBlock {
  id: string;

  input: unknown;

  name: string;

  type: 'tool_use';
}
export type Message = {
  type: MessageType
  uuid: UUID
  timestamp?: string
  isMeta?: boolean
  isVirtual?: boolean
  isCompactSummary?: boolean
  isVisibleInTranscriptOnly?: boolean
  toolUseResult?: unknown
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  message?: {
    role?: ChatCompletionMessageParam['role']
    content?: MessageContent
    tool_calls?: ChatCompletionMessageToolCall[]
    tool_call_id?: string
    usage?: CompletionUsage | Record<string, unknown> 
    refusal?: string | null
    finish_reason?: string | null
    [key: string]: unknown
  }
  attachment?: {
    type: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type UserMessage = Message & {
  type: 'user'
  message: NonNullable<Message['message']>
  imagePasteIds?: number[]
}

export type AssistantMessage = Message & {
  type: 'assistant'
  message: NonNullable<Message['message']>
}

export type ToolMessage = UserMessage & {
  message: NonNullable<Message['message']> & ChatCompletionToolMessageParam
}

export type AttachmentMessage<T = { type: string; [key: string]: unknown }> =
  Message & { type: 'attachment'; attachment: T }

export type ProgressMessage<T = unknown> = Message & {
  type: 'progress'
  data?: T
}

export type SystemMessage = Message & { type: 'system' }
export type SystemLocalCommandMessage = SystemMessage
export type SystemAPIErrorMessage = SystemMessage
export type SystemApiMetricsMessage = SystemMessage
export type SystemAwaySummaryMessage = SystemMessage
export type SystemBridgeStatusMessage = SystemMessage
export type SystemCompactBoundaryMessage = SystemMessage & {
  compactMetadata?: Record<string, unknown>
}
export type SystemInformationalMessage = SystemMessage
export type SystemMemorySavedMessage = SystemMessage
export type SystemMicrocompactBoundaryMessage = SystemMessage
export type SystemPermissionRetryMessage = SystemMessage
export type SystemScheduledTaskFireMessage = SystemMessage
export type SystemAgentsKilledMessage = SystemMessage
export type SystemStopHookSummaryMessage = SystemMessage
export type SystemTurnDurationMessage = SystemMessage
export type SystemMessageLevel = string

export type NormalizedUserMessage = UserMessage
export type NormalizedAssistantMessage<T = unknown> = AssistantMessage & {
  normalized?: T
}
export type NormalizedMessage = UserMessage | AssistantMessage
export type PartialCompactDirection = string
export type MessageOrigin = string

export type RequestStartEvent = {
  type: 'stream_request_start' | string
  [key: string]: unknown
}

export type StreamEvent = {
  type: 'stream_event'
  event: unknown
  uuid?: UUID | string
  timestamp?: string
  [key: string]: unknown
}

export type StopHookInfo = {
  command?: string
  durationMs?: number
  [key: string]: unknown
}

export type TombstoneMessage = Message & { type: 'tombstone' }
export type ToolUseSummaryMessage = Message & {
  type: 'tool_use_summary'
  summary?: string
  precedingToolUseIds?: string[]
}
export interface BetaUsage {
  /**
   * Breakdown of cached tokens by TTL
   */
  cache_creation: BetaCacheCreation | null;

  /**
   * The number of input tokens used to create the cache entry.
   */
  cache_creation_input_tokens: number | null;

  /**
   * The number of input tokens read from the cache.
   */
  cache_read_input_tokens: number | null;

  /**
   * The geographic region where inference was performed for this request.
   */
  inference_geo: string | null;

  /**
   * The number of input tokens which were used.
   */
  input_tokens: number;

  /**
   * Per-iteration token usage breakdown.
   *
   * Each entry represents one sampling iteration, with its own input/output token
   * counts and cache statistics. This allows you to:
   *
   * - Determine which iterations exceeded long context thresholds (>=200k tokens)
   * - Calculate the true context window size from the last iteration
   * - Understand token accumulation across server-side tool use loops
   */
  iterations: BetaIterationsUsage | null;

  /**
   * The number of output tokens which were used.
   */
  output_tokens: number;

  /**
   * The number of server tool requests.
   */
  server_tool_use: BetaServerToolUsage | null;

  /**
   * If the request used the priority, standard, or batch tier.
   */
  service_tier: 'standard' | 'priority' | 'batch' | null;

  /**
   * The inference speed mode used for this request.
   */
  speed: 'standard' | 'fast' | null;
}