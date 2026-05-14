import { z } from 'zod/v4'
import type { ReactNode } from 'react'
import { Theme } from "./utils/theme";
import { AppState } from './state/AppStateStore';
import type { FileStateCache } from './utils/fileStateCache';
import type { FileHistoryState } from './utils/fileHistory';
import { ProgressMessage } from 'src/package/message';
import type { UserMessage,AssistantMessage,AttachmentMessage,SystemMessage } from "src/package/message";
import { Message } from 'src/package/message';
import { ToolResultBlockParam } from 'src/package/message';
import { ThinkingConfig } from './queryEngine';
import { ThemeName } from 'packages/@ant/ink/src';
import { ContentReplacementState } from './utils/toolResultStorage';
export type ToolResult<T> =
{
  type?: string,
  data: T,
  newMessages?: (
    | UserMessage
    | AssistantMessage
    | AttachmentMessage
    | SystemMessage
  )[],
  contextModifier?: (context: ToolUseContext) => ToolUseContext
}
/**
 * Finds a tool by name or alias from a list of tools.
 */
export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return tools.find(t => toolMatchesName(t, name))
}
export type ToolUseContext = {
  options: {
    debug: boolean
    verbose: boolean
    maxBudgetUsd?: number
    thinkingConfig:ThinkingConfig
    customSystemPrompt?: string
    /** Additional system prompt appended after the main system prompt */
    appendSystemPrompt?: string
    mainLoopModel: string
    tools: Tools
    isNonInteractiveSession: boolean
  },
  readFileState: FileStateCache,
  abortController: AbortController,
  /** Custom system prompt that replaces the default system prompt */
  contentReplacementState?: ContentReplacementState,
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  globLimits?: {
    maxResults?: number
  },
  fileReadingLimits?: {
    maxTokens?: number
    maxSizeBytes?: number
  },
  getAppState(): AppState
  setAppState(f: (prev: AppState) => AppState): void
  messages: Message[]

}
// Type for any schema that outputs an object with string keys
export type AnyObject = z.ZodType<{ [key: string]: unknown }>
export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  name: string,
  searchHint:string,//搜索提示
  maxResultSizeChars: number,//工具结果在持久化到磁盘之前允许的最大字符数
  description(
    input: z.infer<Input>
  ): Promise<string>
  readonly inputSchema: Input
  outputSchema?: z.ZodType<unknown>
  call(
    args: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<ToolResult<Output>>
  getToolUseSummary?(input: Partial<z.infer<Input>> | undefined): string | null
  isEnabled(): boolean
  isReadOnly(input: z.infer<Input>): boolean
  isConcurrencySafe(input: z.infer<Input>): boolean
  userFacingName(input: Partial<z.infer<Input>> | undefined): string
  userFacingNameBackgroundColor?(
    input: Partial<z.infer<Input>> | undefined,
  ): keyof Theme | undefined,
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string,
  ): ToolResultBlockParam,
  renderToolUseErrorMessage?(
    result: ToolResultBlockParam['content'],
    options: {
      progressMessagesForMessage: ProgressMessage<P>[]
      tools: Tools
      verbose: boolean
      isTranscriptMode?: boolean
    },
  ): React.ReactNode,
  
  renderToolResultMessage?(
    content: Output,
    progressMessagesForMessage: Message[],
    options: {
      style?: 'condensed'
      theme: Theme
      tools: Tools
      verbose: boolean
      input?: unknown
    },
  ): ReactNode
  renderToolUseMessage?(
    input: Partial<z.infer<Input>>,
    options: { theme: ThemeName; verbose: boolean; commands?: unknown[] },
  ): ReactNode

}
export type ToolDef<
    Input extends AnyObject=AnyObject,
    Output = unknown,
  > = Omit<Tool<Input, Output>, 'isEnabled' | 'isReadOnly' | 'isConcurrencySafe'> &
    Partial<Pick<Tool<Input, Output>, 'isEnabled' | 'isReadOnly' | 'isConcurrencySafe'>>
export type Tools = readonly Tool[]
export function buildTool<Input extends AnyObject, Output = unknown>(
    def: ToolDef<Input, Output>,
  ): Tool<Input, Output> {
    return {
      ...def,
    } as Tool<Input, Output>
}

/**
 * Checks if a tool matches the given name (primary name or alias).检查工具是否匹配给定的名称（主名称或别名）
 */
export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string,
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false)
}
export type ToolProgressData = any