import { useEffect, useRef } from 'react'
import { logError, logMCPDebug } from 'src/utils/log.js'
import { z } from 'zod/v4'
import type {
  ConnectedMCPServer,
    MCPServerConnection
} from '../services/mcp/types.js'
import { getConnectedIdeClient } from 'src/utils/ide.js'
import { lazySchema } from '../utils/lazySchema.js'
import { logForDebugging } from 'src/utils/debug.js'


export type SelectionPoint = {
  line: number
  character: number
}

export type SelectionData = {
  selection: {
    start: SelectionPoint
    end: SelectionPoint
  } | null
  text?: string
  filePath?: string
}

export type IDESelection = {
  lineCount: number
  lineStart?: number
  text?: string
  filePath?: string
}
// Define the selection changed notification schema
const SelectionChangedSchema = lazySchema(() =>
  z.object({
    method: z.literal('selection_changed'),
    params: z.object({
      selection: z
        .object({
          start: z.object({
            line: z.number(),
            character: z.number(),
          }),
          end: z.object({
            line: z.number(),
            character: z.number(),
          }),
        })
        .nullable()
        .optional(),
      text: z.string().optional(),
      filePath: z.string().optional(),
    }),
  }),
)
/**
 * A hook that tracks IDE text selection information by directly registering
 * with MCP client notification handlers一个通过直接注册到MCP客户端通知处理程序来跟踪IDE文本选择信息的钩子
 */
export function useIdeSelection(
  mcpClients: MCPServerConnection[],
  onSelect: (selection: IDESelection) => void,
): void {
  const handlersRegistered = useRef(false)
  const currentIDERef = useRef<ConnectedMCPServer | null>(null)

  useEffect(() => {//如果当前mcp客户端或者当前选择状态变化了  后面的useManage会将mcp客户端加入到mcpClients
    // Find the IDE client from the MCP clients list
    const ideClient = getConnectedIdeClient(mcpClients)//获取处于连接状态的mcp客户端IDE
    // If the IDE client changed, we need to re-register handlers.
    // Normalize undefined to null so the initial ref value (null) matches
    // "no IDE found" (undefined), avoiding spurious resets on every MCP update.如果IDE客户端发生变化，我们需要重新注册处理程序
    if (currentIDERef.current !== (ideClient ?? null)) {
      handlersRegistered.current = false//标记处理器未注册
      currentIDERef.current = ideClient || null
      // Reset the selection when the IDE client changes.
      onSelect({
        lineCount: 0,
        lineStart: undefined,
        text: undefined,
        filePath: undefined,
      })
    }

    // Skip if we've already registered handlers for the current IDE or if there's no IDE client
    if (handlersRegistered.current || !ideClient) {//已注册或者没有ide客户端
      return
    }

    // Handler function for selection changes
    const selectionChangeHandler = (data: SelectionData) => {
      if (data.selection?.start && data.selection?.end) {//如果有选择文本
        const { start, end } = data.selection
        let lineCount = end.line - start.line + 1
        // If on the first character of the line, do not count the line
        // as being selected.
        if (end.character === 0) {
          lineCount--
        }
        const selection = {
          lineCount,
          lineStart: start.line,
          text: data.text,
          filePath: data.filePath,
        }

        onSelect(selection)
        return
      }

      onSelect({//回退标记文件路径
        lineCount: 0,
        lineStart: undefined,
        text: data.text,
        filePath: data.filePath,
      })
    }

    // Register notification handler for selection_changed events
    ideClient.client.setNotificationHandler(//接受selection_change SelectionChangedSchema
      SelectionChangedSchema(),
      notification => {//ide客户端接受到通知消息
        if (currentIDERef.current !== ideClient) {
          return
        }

        logMCPDebug(
          'ide-selection',
          `selection_changed notification received from ${ideClient.name}`,
        )

        try {
          // Get the selection data from the notification params
          const selectionData = notification.params

          // Process selection data - validate it has required properties
          if (
            selectionData.selection &&
            selectionData.selection.start &&
            selectionData.selection.end//如果有选择信息
          ) {
            // Handle selection changes
            selectionChangeHandler(selectionData as SelectionData)
          } else if (selectionData.text !== undefined) {//没有选择信息， 有选择文本
            // Handle empty selection (when text is empty string)
            selectionChangeHandler({
              selection: null,
              text: selectionData.text,
              filePath: selectionData.filePath,
            })
          }
        } catch (error) {
          logError(error as Error)
        }
      },
    )

    // Mark that we've registered handlers
    handlersRegistered.current = true//标记已注册

    // No cleanup needed as MCP clients manage their own lifecycle
  }, [mcpClients, onSelect])
}
