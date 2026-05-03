import { z } from 'zod/v4'
import { Theme } from "./utils/theme";
import { AppState } from './state/AppStateStore';
import { FileStateCache } from './utils/fileStateCache';
import { FileHistoryState } from './utils/fileHistory';
import { UserMessage,AssistantMessage,AttachmentMessage,SystemMessage } from './types/message';
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

}

export type ToolUseContext = {
  options: {
    debug: boolean
    verbose: boolean
    maxBudgetUsd?: number
    customSystemPrompt?: string
    /** Additional system prompt appended after the main system prompt */
    appendSystemPrompt?: string
    mainLoopModel: string
    tools: Tools
    isNonInteractiveSession: boolean
  },
  readFileState: FileStateCache,
  abortController: AbortController,
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
  getAppState?(): AppState
  setAppState?(f: (prev: AppState) => AppState): void

}
// Type for any schema that outputs an object with string keys
export type AnyObject = z.ZodType<{ [key: string]: unknown }>
export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
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
