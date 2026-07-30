import type { ContentBlockParam, ToolUseBlock } from 'src/package/message';
import type {
	AssistantMessage,
	Message,
	ToolResultBlockParam
} from 'src/package/message.js';
import type { ProgressMessage } from 'src/package/message.js';
import { CanUseToolFn } from 'src/hooks/useCanUseTool.js';
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js';
import { BashToolInput } from "src/tools/BashTool/BashTool.js";
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js';
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js';
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js';
import { findToolByName, type ToolUseContext } from '../../Tool.js';
import { createUserMessage } from 'src/utils/messages.js';
import { normalizeToolInput } from 'src/utils/api.js';
import { resolveHookPermissionDecision } from './toolHooks.js';
import { PermissionResult } from 'src/types/permissions.js';
import type { z } from 'zod/v4';
import {
	maybePersistLargeToolResult,
	getPersistenceThreshold,
	processPreMappedToolResultBlock,
	processToolResultBlock
} from 'src/utils/toolResultStorage.js';
// import { Stream } from '../../utils/stream.js'
import { formatZodValidationError } from 'src/utils/toolErrors.js';
import { randomUUID } from 'node:crypto';
import { MCPServerConnection } from '../mcp/types.js';
import { mcpInfoFromString } from 'src/utils/mcpStringUtils.js';
import { getAllBaseTools } from 'src/tools.js';
import { getLoggingSafeMcpBaseUrl, isMcpTool } from '../mcp/utils.js';
import { count } from 'src/utils/array.js';
export type MessageUpdateLazy<M extends Message = Message> = {
	message: M;
	contextModifier?: {
		toolUseID: string;
		modifyContext: (context: ToolUseContext) => ToolUseContext;
	};
};
export type McpServerType =
  | 'stdio'
  | 'sse'
  | 'http'
  | 'ws'
  | 'sdk'
  | 'sse-ide'
  | 'ws-ide'
  | undefined
function findMcpServerConnection(
  toolName: string,
  mcpClients: MCPServerConnection[],
): MCPServerConnection | undefined {
  if (!toolName.startsWith('mcp__')) {//如果是mcp工具
    return undefined
  }

  const mcpInfo = mcpInfoFromString(toolName)
  if (!mcpInfo) {
    return undefined
  }

  // mcpInfo.serverName is normalized (e.g., "claude_ai_Slack"), but client.name
  // is the original name (e.g., "claude.ai Slack"). Normalize both for comparison.
  return mcpClients.find(//根据当前的工具名称找到当前连接的mcp客户端，返回连接
    client => client.name === mcpInfo.serverName,
  )
}
/**
 * Extracts the MCP server transport type from a tool name.
 * Returns the server type (stdio, sse, http, ws, sdk, etc.) for MCP tools,
 * or undefined for built-in tools.
 */
function getMcpServerType(
  toolName: string,
  mcpClients: MCPServerConnection[],
): McpServerType {
  const serverConnection = findMcpServerConnection(toolName, mcpClients)//这里多了一个判定连接状态是不是已连接

  if (serverConnection?.type === 'connected') {
    // Handle stdio configs where type field is optional (defaults to 'stdio')
    return serverConnection.config.type ?? 'stdio'
  }
  return undefined
}
/**
 * Extracts the MCP server base URL for a tool by looking up its server connection.
 * Returns undefined for stdio servers, built-in tools, or if the server is not connected.
 */
function getMcpServerBaseUrlFromToolName(
  toolName: string,
  mcpClients: MCPServerConnection[],
): string | undefined {
  const serverConnection = findMcpServerConnection(toolName, mcpClients)
  if (serverConnection?.type !== 'connected') {
    return undefined
  }
  return getLoggingSafeMcpBaseUrl(serverConnection.config)
}

  // function streamedCheckPermissionsAndCallTool(
//   tool: Tool,
//   toolUseID: string,
//   input: { [key: string]: boolean | string | number },
//   toolUseContext: ToolUseContext,
//   assistantMessage: AssistantMessage,
// ): AsyncIterable<MessageUpdateLazy> {
//   // This is a bit of a hack to get progress events and final results
//   // into a single async iterable.
//   //
//   // Ideally the progress reporting and tool call reporting would
//   // be via separate mechanisms.
//   const stream = new Stream<MessageUpdateLazy>()
//   checkPermissionsAndCallTool(
//     tool,
//     toolUseID,
//     input,
//     toolUseContext,
//     assistantMessage,

//   )
//     .then(results => {
//       for (const result of results) {
//         stream.enqueue(result)
//       }
//     })
//     .catch(error => {
//       stream.error(error)
//     })
//     .finally(() => {
//       stream.done()
//     })
//   return stream
// }

export async function* runToolUse(
	toolUse: ToolUseBlock,
	assistantMessage: AssistantMessage,
	toolUseContext: ToolUseContext,
	canUseTool: CanUseToolFn,
): AsyncGenerator<MessageUpdateLazy, void> {
	const toolName = toolUse.name
	let tool = findToolByName(toolUseContext.options.tools, toolUse.name);
	if (!tool) {
		const msg = `Error: No such tool available: ${toolUse.name}`;
		yield {
			message: createUserMessage({
				content: [
					{
						type: 'tool_result',
						content: `<tool_use_error>${msg}</tool_use_error>`,
						is_error: true,
						tool_use_id: toolUse.id
					}
				],
				toolUseResult: msg,
				sourceToolAssistantUUID: assistantMessage.uuid
			})
		};
		return;
	}
	const messageId = assistantMessage.message.id as string
  	const requestId = assistantMessage.requestId as string | undefined
	const mcpServerType = getMcpServerType(//获取当前工具对应Mcp服务器的类型
		toolName,
		toolUseContext.options.mcpClients,
	)
	const mcpServerBaseUrl = getMcpServerBaseUrlFromToolName(
		toolName,
		toolUseContext.options.mcpClients,
  	)

	// const messageId = assistantMessage.message.id as string
	// const requestId = assistantMessage.requestId as string | undefined
	
	const toolInput = toolUse.input as { [key: string]: string };
	// try {
	//   if (toolUseContext.abortController.signal.aborted) {
	//     const content = createToolResultStopMessage(toolUse.id)
	//     yield {
	//       message: createUserMessage({
	//         content: [content],
	//         toolUseResult: CANCEL_MESSAGE,
	//         sourceToolAssistantUUID: assistantMessage.uuid,
	//       }),
	//     }
	//     return
	//   }

	//   for await (const update of streamedCheckPermissionsAndCallTool(
	//     tool,
	//     toolUse.id,
	//     toolInput,
	//     toolUseContext,
	//     assistantMessage,
	//   )) {
	//     yield update
	//   }
	// } catch (error) {
	//   logError(error)
	//   const errorMessage = error instanceof Error ? error.message : String(error)
	//   const toolInfo = tool ? ` (${tool.name})` : ''
	//   const detailedError = `Error calling tool${toolInfo}: ${errorMessage}`

	//   yield {
	//     message: createUserMessage({
	//       content: [
	//         {
	//           type: 'tool_result',
	//           content: `<tool_use_error>${detailedError}</tool_use_error>`,
	//           is_error: true,
	//           tool_use_id: toolUse.id,
	//         },
	//       ],
	//       toolUseResult: detailedError,
	//       sourceToolAssistantUUID: assistantMessage.uuid,
	//     }),
	//   }
	// }
	const normalizedInput = normalizeToolInput(
		tool,
		toolUse.input as z.infer<typeof tool.inputSchema>
	);
	const parsedInput = tool.inputSchema.safeParse(normalizedInput);
	if (!parsedInput.success) {
		let errorContent = formatZodValidationError(
			tool.name,
			parsedInput.error
		);

		yield {
			message: createUserMessage({
				content: [
					{
						type: 'tool_result',
						content: `<tool_use_error>InputValidationError: ${errorContent}</tool_use_error>`,
						is_error: true,
						tool_use_id: toolUse.id
					}
				],
				toolUseResult: `InputValidationError: ${parsedInput.error.message}`,
				sourceToolAssistantUUID: assistantMessage.uuid
			})
		};
		return;
	}
	// Validate input values. Each tool has its own validation logic
	const isValidCall = await tool.validateInput?.(
		//验证输入 不然直接返回 关卡
		parsedInput.data,
		toolUseContext
	);
	if (isValidCall?.result === false) {
		yield {
			message: createUserMessage({
				content: [
					{
						type: 'tool_result',
						content: `<tool_use_error>${isValidCall.message}</tool_use_error>`,
						is_error: true,
						tool_use_id: toolUse.id
					}
				],
				toolUseResult: `Error: ${isValidCall.message}`,
				sourceToolAssistantUUID: assistantMessage.uuid
			})
		};
	}
	let processedInput = parsedInput.data
	let hookPermissionResult: PermissionResult | undefined
	const toolAttributes: Record<string, string | number | boolean> = {}
	if (processedInput && typeof processedInput === 'object') {
		if (tool.name === FILE_READ_TOOL_NAME && 'file_path' in processedInput) {
		toolAttributes.file_path = String(processedInput.file_path)
		} else if (
		(tool.name === FILE_EDIT_TOOL_NAME ||
			tool.name === FILE_WRITE_TOOL_NAME) &&
		'file_path' in processedInput
		) {
		toolAttributes.file_path = String(processedInput.file_path)
		} else if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
		const bashInput = processedInput as BashToolInput
		toolAttributes.full_command = bashInput.command
		}
	}
	// Check whether we have permission to use the tool,
	// and ask the user for permission if we don't
	const permissionMode = toolUseContext.getAppState().toolPermissionContext.mode
	const permissionStart = Date.now()
	
	const resolved = await resolveHookPermissionDecision(
		hookPermissionResult,
		tool,
		processedInput,
		toolUseContext,
		canUseTool,
		assistantMessage,
		toolUse.id,
	)
	const permissionDecision = resolved.decision
	processedInput = resolved.input
	const permissionDurationMs = Date.now() - permissionStart


	if (permissionDecision && permissionDecision.behavior !== 'allow') {
 		let errorMessage = permissionDecision.message


		const message =
			permissionDecision.message || 'Tool use was rejected by the user.';
		const contentBlocks =
			permissionDecision.behavior === 'ask'
				? (permissionDecision.contentBlocks ?? [])
				: [];
		yield {
			message: createUserMessage({
				content: [
					...contentBlocks,
					{
						type: 'tool_result',
						content: `<tool_use_error>${message}</tool_use_error>`,
						is_error: true,
						tool_use_id: toolUse.id
					}
				],
				toolUseResult: message,
				sourceToolAssistantUUID: assistantMessage.uuid
			})
		};
		return;
	}

	const permittedInput =
		permissionDecision?.behavior === 'allow'
			? (permissionDecision.updatedInput ?? parsedInput.data)
			: parsedInput.data;
	try {
		const pendingUpdates: MessageUpdateLazy[] = [];
		let waitingResolver: (() => void) | null = null;
		let settled = false;
		let toolResult: Awaited<ReturnType<typeof tool.call>> | undefined;
		let toolError: unknown;
		const notify = () => {
			if (waitingResolver) {
				const resolve = waitingResolver;
				waitingResolver = null;
				resolve();
			}
		};

		void tool
			.call(
				permittedInput,
				toolUseContext,
				canUseTool,
				assistantMessage,
				progress => {
					pendingUpdates.push({
						message: {
							type: 'progress',
							uuid: randomUUID(),
							timestamp: new Date().toISOString(),
							data: progress.data,
							toolUseID: toolUse.id
						} as ProgressMessage
					});
					notify();
				}
			)
			.then(result => {
				toolResult = result;
				settled = true;
				notify();
			})
			.catch(error => {
				toolError = error;
				settled = true;
				notify();
			});

		while (!settled || pendingUpdates.length > 0) {
			while (pendingUpdates.length > 0) {
				const update = pendingUpdates.shift();
				if (update) {
					yield update;
				}
			}

			if (settled) {
				break;
			}

			await new Promise<void>(resolve => {
				waitingResolver = resolve;
				if (settled || pendingUpdates.length > 0) {
					const wake = waitingResolver;
					waitingResolver = null;
					wake?.();
				}
			});
		}

		if (toolError) {
			throw toolError;
		}
		if (!toolResult) {
			throw new Error(`Tool ${tool.name} completed without a result.`);
		}
		const mappedToolResultBlock = tool.mapToolResultToToolResultBlockParam(
			toolResult.data,
			toolUse.id
		);
		const mappedContent = mappedToolResultBlock.content
		const toolResultSizeBytes = !mappedContent
		? 0
		: typeof mappedContent === 'string'
			? mappedContent.length
			: JSON.stringify(mappedContent).length
		let toolOutput = toolResult.data
		const hookResults = []
		const toolContextModifier = toolResult.contextModifier
		const mcpMeta = toolResult.mcpMeta
		async function addToolResult(
			toolUseResult: unknown,
			preMappedBlock?: ToolResultBlockParam,
		) {
			// Use the pre-mapped block when available (non-MCP tools where hooks
			// don't modify the output), otherwise map from scratch.
			const toolResultBlock = preMappedBlock//
				? await processPreMappedToolResultBlock(//只执行maybePersistLargeToolResult
					preMappedBlock,
					tool!.name,
					tool!.maxResultSizeChars,
				)
				: await processToolResultBlock(tool!, toolUseResult, toolUse.id)

			// Build content blocks - tool result first, then optional feedback
			const contentBlocks: ContentBlockParam[] = [toolResultBlock]
			// Add accept feedback if user provided feedback when approving
			// (acceptFeedback only exists on PermissionAllowDecision, which is guaranteed here)
			if (
				'acceptFeedback' in permissionDecision &&
				permissionDecision.acceptFeedback
			) {
				contentBlocks.push({
				type: 'text',
				text: permissionDecision.acceptFeedback,
				})
			}

			// Add content blocks (e.g., pasted images) from the permission decision
			const allowContentBlocks =
				'contentBlocks' in permissionDecision
				? permissionDecision.contentBlocks
				: undefined
			if (allowContentBlocks?.length) {
				contentBlocks.push(...allowContentBlocks)
			}

			// Generate sequential imagePasteIds so each image renders with a distinct label
			let allowImageIds: number[] | undefined
			if (allowContentBlocks?.length) {
				// const imageCount = count(
				// allowContentBlocks,
				// (b: ContentBlockParam) => b.type === 'image',
				// )
				// if (imageCount > 0) {
				// 	const startId = getNextImagePasteId(toolUseContext.messages)
				// 	allowImageIds = Array.from(
				// 		{ length: imageCount },
				// 		(_, i) => startId + i,
				// 	)
				// }
			}

			return {
				message: createUserMessage({
				content: contentBlocks,
				imagePasteIds: allowImageIds,
				toolUseResult:
					toolUseResult,
				mcpMeta: mcpMeta,
				sourceToolAssistantUUID: assistantMessage.uuid,
				}),
				contextModifier: toolContextModifier
				? {
					toolUseID: toolUse.id,
					modifyContext: toolContextModifier,
					}
				: undefined,
			}
			}
		// TOOD(hackyon)：重构，以便我们对 MCP 工具没有不同的体验
		if (!isMcpTool(tool)) {
			yield await addToolResult(toolOutput, mappedToolResultBlock)
		}
		if (isMcpTool(tool)) {
			yield await addToolResult(toolOutput)
		}


		if (toolResult.newMessages && toolResult.newMessages.length > 0) {
			for (const message of toolResult.newMessages) {
				yield { message };
			}
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const detail = `Error calling tool (${tool.name}): ${msg}`;
		yield {
			message: createUserMessage({
				content: [
					{
						type: 'tool_result',
						content: `<tool_use_error>${detail}</tool_use_error>`,
						is_error: true,
						tool_use_id: toolUse.id
					}
				],
				toolUseResult: detail,
				sourceToolAssistantUUID: assistantMessage.uuid
			})
		};
	}
}

