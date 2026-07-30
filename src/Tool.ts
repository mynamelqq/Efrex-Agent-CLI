import { z } from 'zod/v4';
import type { ReactNode } from 'react';
import { Theme } from './utils/theme';
import { AppState } from './state/AppStateStore';
import { MCPServerConnection } from './services/mcp/types';
import type { FileStateCache } from './utils/fileStateCache';
import type { FileHistoryState } from './utils/fileHistory';
import { ProgressMessage } from 'src/package/message';
import type {
  ElicitRequestURLParams,
  ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'
import {UUID}from "crypto";
import type {
	UserMessage,
	AssistantMessage,
	AttachmentMessage,
	SystemMessage
} from 'src/package/message';
import { Message } from 'src/package/message';
import { ToolResultBlockParam } from 'src/package/message';
import { Command } from './types/command';
import { ThinkingConfig } from "src/utils/effort";
import { ThemeName } from 'packages/@ant/ink/src';
import { ContentReplacementState } from './utils/toolResultStorage';
import { DeepImmutable } from './types/utils';
import { CanUseToolFn } from './hooks/useCanUseTool';
import {
	PermissionMode,
	ToolPermissionRulesBySource
} from './types/permissions';
import { PermissionDecision, PermissionResult } from './types/permissions';
export type ToolInputJSONSchema = {
  [x: string]: unknown
  type: 'object'
  properties?: {
    [x: string]: unknown
  }
}
export type ValidationResult =
	| { result: true }
	| {
			result: false;
			message: string;
			errorCode: number;
	  };

export type CompactProgressEvent =
	| {
			type: 'hooks_start';
			hookType: 'pre_compact' | 'post_compact' | 'session_start';
	  }
	| { type: 'compact_start' }
	| { type: 'compact_end' };

export type SetToolJSXFn = (
	args:
		| {
				jsx: ReactNode | null;
				shouldHidePromptInput: boolean;
				shouldContinueAnimation?: true;
				showSpinner?: boolean;
				isLocalJSXCommand?: boolean;
				isImmediate?: boolean;
				clearLocalJSX?: boolean;
		  }
		| null
) => void;
// Apply DeepImmutable to the imported type
export type ToolPermissionContext = DeepImmutable<{
	mode: PermissionMode;
	alwaysAllowRules: ToolPermissionRulesBySource;
	alwaysDenyRules: ToolPermissionRulesBySource;
	alwaysAskRules: ToolPermissionRulesBySource;
	isBypassPermissionsModeAvailable: boolean;
	isAutoModeAvailable?: boolean;
	strippedDangerousRules?: ToolPermissionRulesBySource;
	/** When true, permission prompts are auto-denied (e.g., background agents that can't show UI) */
	shouldAvoidPermissionPrompts?: boolean;
	/** When true, automated checks (classifier, hooks) are awaited before showing the permission dialog (coordinator workers) */
	awaitAutomatedChecksBeforeDialog?: boolean;
	/** Stores the permission mode before model-initiated plan mode entry, so it can be restored on exit */
	prePlanMode?: PermissionMode;
}>;
export type CompletedTurnFooter = {
	afterMessageCount: number;
	text: string;
};
export type ToolResult<T> = {
	type?: string;
	data: T;
	newMessages?: (
		| UserMessage
		| AssistantMessage
		| AttachmentMessage
		| SystemMessage
	)[];
	contextModifier?: (context: ToolUseContext) => ToolUseContext;
	/** MCP 协议元数据（structedContent、_meta）传递给 SDK 使用者 */
	mcpMeta?: {
		_meta?: Record<string, unknown>
		structuredContent?: Record<string, unknown>
	}
};

/**
 * Finds a tool by name or alias from a list of tools.
 */
export function findToolByName(tools: Tools, name: string): Tool | undefined {
	return tools.find(t => toolMatchesName(t, name));
}
export type ToolUseContext = {
	options: {
		commands: Command[]
		debug: boolean;
		verbose: boolean;
		maxBudgetUsd?: number;
		thinkingConfig: ThinkingConfig;
		customSystemPrompt?: string;
		/** Additional system prompt appended after the main system prompt */
		appendSystemPrompt?: string;
		mainLoopModel: string;
		tools: Tools;
		isNonInteractiveSession: boolean;
		mcpClients: MCPServerConnection[]
		/** 用于获取最新工具的可选回调（例如，在 MCP 服务器连接查询中后） */
    	refreshTools?: () => Tools
	};
	readFileState: FileStateCache;
	// addNotification?: (notif: Notification) => void
	abortController: AbortController;

	/** Custom system prompt that replaces the default system prompt */
	contentReplacementState?: ContentReplacementState;
	userModified?: boolean;
	  /**
	 * 由工具调用错误触发的 URL 引发的可选处理程序 (-32042)。
	 * 在打印/SDK 模式下，这委托给 StructuredIO.handleElicitation。
	 * 在 REPL 模式下，这是未定义的，并且使用基于队列的 UI 路径。
	 */
	handleElicitation?: (
		serverName: string,
		params: ElicitRequestURLParams,
		signal: AbortSignal,
	) => Promise<ElicitResult>
  	toolUseId?: string
	updateFileHistoryState: (
		updater: (prev: FileHistoryState) => FileHistoryState
	) => void;
	globLimits?: {
		maxResults?: number;
	};
	fileReadingLimits?: {
		maxTokens?: number;
		maxSizeBytes?: number;
	};
  	setConversationId?: (id: UUID) => void
	getAppState(): AppState;
	setAppState(f: (prev: AppState) => AppState): void;
	setResponseLength?: (f: (prev: number) => number) => void;
	setStreamMode?: (mode: 'requesting' | 'responding') => void;
	onCompactProgress?: (event: CompactProgressEvent) => void;
	messages: Message[];
	setToolJSX?: SetToolJSXFn;
	setCompletedTurnFooters?: (footers: CompletedTurnFooter[]) => void;
	resetMainScroll?: () => void;
};
// Type for any schema that outputs an object with string keys
export type AnyObject = z.ZodType<{ [key: string]: unknown }>;
export type Tool<
	Input extends AnyObject = AnyObject,
	Output = unknown,
	P extends ToolProgressData = ToolProgressData
> = {
	name: string;
	searchHint?: string; //搜索提示
	inputsEquivalent?(a: z.infer<Input>, b: z.infer<Input>): boolean;
	maxResultSizeChars: number; //工具结果在持久化到磁盘之前允许的最大字符数
	  /**
* 当此工具为真时，它永远不会被延迟——即使启用了 ToolSearch，
* 其完整架构仍会显示在初始提示中。
* 对于MCP工具，请通过 `_meta['anthropic/alwaysLoad']` 设置。适用于模型必须在第一轮就看到、无需 ToolSearch 循环访问的工具。
	 */
	readonly alwaysLoad?: boolean
	description(
		input: z.infer<Input>,
		options: {
			isNonInteractiveSession: boolean;
			toolPermissionContext: ToolPermissionContext;
			tools: Tools;
		}
	): Promise<string>;
	checkPermissions(
		input: z.infer<Input>,
		context: ToolUseContext
	): Promise<PermissionResult>;
	readonly inputSchema: Input;
	  // Type for MCP tools that can specify their input schema directly in JSON Schema format
	// rather than converting from Zod schema
	readonly inputJSONSchema?: ToolInputJSONSchema

	// Optional method for tools that operate on a file path
	getPath?(input: z.infer<Input>): string;
	  /**
* 对于MCP工具：从MCP服务器接收到的服务器和工具名称（未标准化）。
*  * 无论`name`是否带有前缀（mcp__server__tool）或无前缀（CLAUDE_AGENT_SDK_MCP_NO_PREFIX模式），所有MCP工具均包含此信息。
	 */
	mcpInfo?: { serverName: string; toolName: string }
	isMcp?: boolean
	outputSchema?: z.ZodType<unknown>;
	/**
	 * Determines if this tool is allowed to run with this input in the current context.
	 * It informs the model of why the tool use failed, and does not directly display any UI.
	 * @param input
	 * @param context
	 */
	validateInput?(
		input: z.infer<Input>,
		context: ToolUseContext
	): Promise<ValidationResult>;
	call(
		args: z.infer<Input>,
		context: ToolUseContext,
		canUseTool?: CanUseToolFn,
		parentMessage?: AssistantMessage,
		onProgress?: ToolCallProgress<P>
	): Promise<ToolResult<Output>>;
	getToolUseSummary?(
		input: Partial<z.infer<Input>> | undefined
	): string | null;
	isEnabled(): boolean;
	isReadOnly(input: z.infer<Input>): boolean;
	isConcurrencySafe(input: z.infer<Input>): boolean;
	userFacingName(input: Partial<z.infer<Input>> | undefined): string;
	userFacingNameBackgroundColor?(
		input: Partial<z.infer<Input>> | undefined
	): keyof Theme | undefined;
	mapToolResultToToolResultBlockParam(
		content: Output,
		toolUseID: string
	): ToolResultBlockParam;
	renderToolUseErrorMessage?(
		result: ToolResultBlockParam['content'],
		options: {
			progressMessagesForMessage: ProgressMessage<P>[];
			tools: Tools;
			verbose: boolean;
			isTranscriptMode?: boolean;
		}
	): React.ReactNode;
	/**
	 * Optional. When omitted, no progress UI is shown while the tool runs.
	 */
	renderToolUseProgressMessage?(
		progressMessagesForMessage: ProgressMessage<P>[],
		options: {
			tools: Tools;
			verbose: boolean;
			terminalSize?: { columns: number; rows: number };
			inProgressToolCallCount?: number;
			isTranscriptMode?: boolean;
		}
	): React.ReactNode;
	renderToolResultMessage?(
		content: Output,
		progressMessagesForMessage: Message[],
		options: {
			style?: 'condensed';
			theme: Theme;
			tools: Tools;
			verbose: boolean;
			input?: unknown;
		}
	): ReactNode;
	renderToolUseMessage?(
		input: Partial<z.infer<Input>>,
		options: { theme: ThemeName; verbose: boolean; commands?: unknown[] }
	): ReactNode;
	/**
   * Returns information about whether this tool use is a search or read operation
   * that should be collapsed into a condensed display in the UI. Examples include
   * file searching (Grep, Glob), file reading (Read), and bash commands like find,
   * grep, wc, etc.
   *
   * Returns an object indicating whether the operation is a search or read operation:
   * - `isSearch: true` for search operations (grep, find, glob patterns)
   * - `isRead: true` for read operations (cat, head, tail, file read)
   * - `isList: true` for directory-listing operations (ls, tree, du)
   * - All can be false if the operation shouldn't be collapsed
   */
  isSearchOrReadCommand?(input: z.infer<Input>): {
    isSearch: boolean
    isRead: boolean
    isList?: boolean
  },
    /**
   * Returns true when the non-verbose rendering of this output is truncated
   * (i.e., clicking to expand would reveal more content). Gates
   * click-to-expand in fullscreen — only messages where verbose actually
   * shows more get a hover/click affordance. Unset means never truncated.
   */
  isResultTruncated?(output: Output): boolean
};
export type ToolDef<
	Input extends AnyObject = AnyObject,
	Output = unknown
> = Omit<
	Tool<Input, Output>,
	'isEnabled' | 'isReadOnly' | 'isConcurrencySafe'
> &
	Partial<
		Pick<
			Tool<Input, Output>,
			'isEnabled' | 'isReadOnly' | 'isConcurrencySafe'
		>
	>;
export type Tools = readonly Tool[];
export function buildTool<Input extends AnyObject, Output = unknown>(
	def: ToolDef<Input, Output>
): Tool<Input, Output> {
	return {
		...def
	} as Tool<Input, Output>;
}
export type ToolProgress<P extends ToolProgressData> = {
  toolUseID: string
  data: P
}
export type ToolCallProgress<P extends ToolProgressData = ToolProgressData> = (
  progress: ToolProgress<P>,
) => void
/**
 * Checks if a tool matches the given name (primary name or alias).检查工具是否匹配给定的名称（主名称或别名）
 */
export function toolMatchesName(
	tool: { name: string; aliases?: string[] },
	name: string
): boolean {
	return tool.name === name || (tool.aliases?.includes(name) ?? false);
}
export type ToolProgressData = any;

export const getEmptyToolPermissionContext: () => ToolPermissionContext =
	() => ({
		mode: 'default',//默认权限模式为default
		additionalWorkingDirectories: new Map(),//额外的工作文件夹
		alwaysAllowRules: {},
		alwaysDenyRules: {},
		alwaysAskRules: {},
		isBypassPermissionsModeAvailable: true
	});
