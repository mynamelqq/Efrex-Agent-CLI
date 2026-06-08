import React from 'react'
import { Text } from '../../ink.js'
import type { Tool, ToolProgressData } from '../../Tool.js'
import { defaultToolRenderTheme } from '../../utils/theme.js'
import { logForDebugging } from '../../utils/debug.js'
import type { ProgressMessage } from '../../package/message.js'

export function normalizeToolRenderNode(node: React.ReactNode): React.ReactNode | null {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return null
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return <Text>{String(node)}</Text>
  }

  return node
}

export function renderToolUseContent(
  tool: Tool | undefined,
  input: Record<string, unknown> | undefined,
  verbose = false,
): React.ReactNode | null {
  if (!tool?.renderToolUseMessage || !input) {
    return null
  }

  try {
    return normalizeToolRenderNode(tool.renderToolUseMessage(input, {
      theme: defaultToolRenderTheme,
      verbose,
      commands: [],
    }))
  } catch {
    logForDebugging(`Error rendering tool use message for ${tool.name}`, { level: 'error' })
    return null
  }
}

export function renderToolResultContent(
  tool: Tool | undefined,
  output: unknown,
  input: unknown,
  tools: readonly Tool[],
  verbose = false,
): React.ReactNode | null {
  if (!tool?.renderToolResultMessage) {
    return null
  }

  try {
    return normalizeToolRenderNode(tool.renderToolResultMessage(output, [], {
      theme: defaultToolRenderTheme,
      tools,
      verbose,
      input,
    }))
  } catch {
    logForDebugging(`Error rendering tool result message for ${tool.name}`, { level: 'error' })
    return null
  }
}

export function renderToolErrorContent(
  tool: Tool | undefined,
  result: unknown,
  tools: readonly Tool[],
  verbose = false,
): React.ReactNode | null {
  if (!tool?.renderToolUseErrorMessage) {
    return null
  }

  try {
    return normalizeToolRenderNode(
      tool.renderToolUseErrorMessage(result as string | Record<string, unknown>[], {
        progressMessagesForMessage: [],
        tools,
        verbose,
        isTranscriptMode: verbose,
      }),
    )
  } catch {
    logForDebugging(`Error rendering tool error message for ${tool.name}`, {
      level: 'error',
    })
    return null
  }
}

export function renderToolProgressContent(
  tool: Tool | undefined,
  progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  tools: readonly Tool[],
  verbose = false,
  terminalSize?: { columns: number; rows: number },
  inProgressToolCallCount = 1,
): React.ReactNode | null {
  if (!tool?.renderToolUseProgressMessage) {
    return null
  }

  try {
    return normalizeToolRenderNode(
      tool.renderToolUseProgressMessage(progressMessagesForMessage, {
        tools,
        verbose,
        terminalSize,
        inProgressToolCallCount,
        isTranscriptMode: verbose,
      }),
    )
  } catch {
    logForDebugging(`Error rendering tool progress message for ${tool.name}`, {
      level: 'error',
    })
    return null
  }
}
