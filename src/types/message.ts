// src/types/message.ts

import type { APIError } from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions';

// 基础类型定义
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
type MessageOrigin = 'summary' | 'compact' | 'user';
type SystemMessageLevel = 'info' | 'error' | 'warning' | 'debug';
type PartialCompactDirection = 'forward' | 'backward';

// 进度类型
interface Progress {
  type: string;
  [key: string]: unknown;
}

// 附件类型联合
type Attachment = 
  | { type: 'file'; data: unknown }
  | { type: 'edited_text_file'; data: unknown }
  | { type: 'edited_image_file'; data: unknown }
  | { type: 'directory'; data: unknown }
  | { type: 'structured_output'; data: unknown }
  | { type: 'max_turns_reached'; data: unknown }
  | { type: 'queued_command'; data: unknown }
  | { type: 'teammate_shutdown_batch'; data: unknown };

// SDK错误类型
interface SDKAssistantMessageError {
  message: string;
  type?: string;
  [key: string]: unknown;
}

// 汇总元数据
interface SummarizeMetadata {
  messagesSummarized: number;
  userContext?: string;
  direction?: PartialCompactDirection;
}

// MCP元数据
interface MCPMeta {
  _meta?: Record<string, unknown>;
  structuredContent?: Record<string, unknown>;
}

// 压缩元数据
interface CompactMetadata {
  trigger: string;
  preTokens: number;
  userContext: string;
  messagesSummarized: number;
}

// User Message
export interface UserMessage {
  type: 'user';
  message: ChatCompletionUserMessageParam;
  uuid: string;
  timestamp: string;
  isMeta?: true;
  isVisibleInTranscriptOnly?: true;
  isVirtual?: true;
  isCompactSummary?: true;
  toolUseResult?: unknown;
  mcpMeta?: MCPMeta;
  imagePasteIds?: number[];
  sourceToolAssistantUUID?: string;
  permissionMode?: PermissionMode;
  summarizeMetadata?: SummarizeMetadata;
  origin?: MessageOrigin;
}

// Assistant Message
export interface AssistantMessage {
  type: 'assistant';
  message: ChatCompletionMessage;
  uuid: string;
  timestamp: string;
  isVirtual?: true;
  isApiErrorMessage?: boolean;
  apiError?: string;
  error?: SDKAssistantMessageError;
  errorDetails?: string;
  requestId?: string;
}

// System Informational Message
export interface SystemInformationalMessage {
  type: 'system';
  subtype: 'informational';
  content?: string;
  uuid: string;
  timestamp: string;
  level?: SystemMessageLevel;
  isMeta?: boolean;
  toolUseID?: string;
  preventContinuation?: boolean;
}

// System Compact Boundary Message
export interface SystemCompactBoundaryMessage {
  type: 'system';
  subtype: 'compact_boundary';
  content?: string;
  uuid: string;
  timestamp: string;
  level?: SystemMessageLevel;
  isMeta?: boolean;
  toolUseID?: string;
  compactMetadata: CompactMetadata;
  logicalParentUuid?: string;
}

// System API Error Message
export interface SystemAPIErrorMessage {
  type: 'system';
  subtype: 'api_error';
  content?: string;
  uuid: string;
  timestamp: string;
  level?: SystemMessageLevel;
  isMeta?: boolean;
  toolUseID?: string;
  error: APIError;
  retryInMs: number;
  retryAttempt: number;
  maxRetries: number;
  cause?: Error;
}

// System Local Command Message
export interface SystemLocalCommandMessage {
  type: 'system';
  subtype: 'local_command';
  content?: string;
  uuid: string;
  timestamp: string;
  level?: SystemMessageLevel;
  isMeta?: boolean;
  toolUseID?: string;
}

// System Permission Retry Message
export interface SystemPermissionRetryMessage {
  type: 'system';
  subtype: 'permission_retry';
  content?: string;
  uuid: string;
  timestamp: string;
  level?: SystemMessageLevel;
  isMeta?: boolean;
  toolUseID?: string;
  commands: string[];
}

// System Bridge Status Message
export interface SystemBridgeStatusMessage {
  type: 'system';
  subtype: 'bridge_status';
  content?: string;
  uuid: string;
  timestamp: string;
  level?: SystemMessageLevel;
  isMeta?: boolean;
  toolUseID?: string;
  url: string;
  upgradeNudge?: boolean;
}

// System Other Message (用于其他子类型)
export interface SystemOtherMessage {
  type: 'system';
  subtype: 'agents_killed' | 'away_summary' | 'api_metrics' | 'memory_saved' | 'microcompact_boundary' | 'scheduled_task_fire' | 'stop_hook_summary' | 'turn_duration';
  content?: string;
  uuid: string;
  timestamp: string;
  level?: SystemMessageLevel;
  isMeta?: boolean;
  toolUseID?: string;
}

// 联合所有系统消息类型
export type SystemMessage = SystemInformationalMessage | SystemCompactBoundaryMessage | SystemAPIErrorMessage | SystemLocalCommandMessage | SystemPermissionRetryMessage | SystemBridgeStatusMessage | SystemOtherMessage;

// Progress Message
export interface ProgressMessage {
  type: 'progress';
  data: Progress;
  toolUseID: string;
  parentToolUseID: string;
  uuid: string;
  timestamp: string;
}

// Attachment Message
export interface AttachmentMessage {
  type: 'attachment';
  attachment: Attachment;
  uuid: string;
  timestamp: string;
}

// Stream Event - OpenAI Chat Completions 流事件类型
type OpenAIStreamEvent =
  | ChatCompletionChunk
  | { type: 'error'; error: Error };

export interface StreamEvent {
  type: 'stream_event';
  event: OpenAIStreamEvent;
  ttftMs?: number; // 首个 OpenAI chunk 到达时出现
  uuid: string;
  timestamp: string;
}

// Tool Use Summary Message
export interface ToolUseSummaryMessage {
  type: 'tool_use_summary';
  summary: string;
  precedingToolUseIds: string[];
  uuid: string;
  timestamp: string;
}

// Tombstone Message
export interface TombstoneMessage {
  type: 'tombstone';
  message: AssistantMessage; // 要标记为删除的消息
  uuid: string;
  timestamp: string;
}

// Discriminated Union 主类型
export type Message = 
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | ProgressMessage
  | AttachmentMessage
  | StreamEvent
  | ToolUseSummaryMessage
  | TombstoneMessage;

// 类型守卫函数
export const isUserMessage = (message: Message): message is UserMessage => message.type === 'user';
export const isAssistantMessage = (message: Message): message is AssistantMessage => message.type === 'assistant';
export const isSystemMessage = (message: Message): message is SystemMessage => message.type === 'system';
export const isProgressMessage = (message: Message): message is ProgressMessage => message.type === 'progress';
export const isAttachmentMessage = (message: Message): message is AttachmentMessage => message.type === 'attachment';
export const isStreamEvent = (message: Message): message is StreamEvent => message.type === 'stream_event';
export const isToolUseSummaryMessage = (message: Message): message is ToolUseSummaryMessage => message.type === 'tool_use_summary';
export const isTombstoneMessage = (message: Message): message is TombstoneMessage => message.type === 'tombstone';

// 系统消息子类型守卫
export const isSystemInformationalMessage = (message: SystemMessage): message is SystemInformationalMessage => message.subtype === 'informational';
export const isSystemCompactBoundaryMessage = (message: SystemMessage): message is SystemCompactBoundaryMessage => message.subtype === 'compact_boundary';
export const isSystemAPIErrorMessage = (message: SystemMessage): message is SystemAPIErrorMessage => message.subtype === 'api_error';
export const isSystemLocalCommandMessage = (message: SystemMessage): message is SystemLocalCommandMessage => message.subtype === 'local_command';
export const isSystemPermissionRetryMessage = (message: SystemMessage): message is SystemPermissionRetryMessage => message.subtype === 'permission_retry';
export const isSystemBridgeStatusMessage = (message: SystemMessage): message is SystemBridgeStatusMessage => message.subtype === 'bridge_status';
