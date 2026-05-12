import React from 'react'
import { Text } from '../../ink.js'
import type { Tool } from '../../Tool.js'
import { defaultToolRenderTheme } from '../../utils/theme.js'
import { logForDebugging } from '../../utils/debug.js'

export function normalizeToolRenderNode(node: React.ReactNode): React.ReactNode | null {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return null
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return <Text>{String(node)}</Text>
  }

  return node
}

export function renderToolUseContent(tool: Tool | undefined, input: unknown): React.ReactNode | null {
  if (!tool?.renderToolUseMessage) {
    return null
  }

  try {
    return normalizeToolRenderNode(tool.renderToolUseMessage(input as Record<string, unknown>, {
      theme: defaultToolRenderTheme,
      verbose: true,
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
): React.ReactNode | null {
  if (!tool?.renderToolResultMessage) {
    return null
  }

  try {
    return normalizeToolRenderNode(tool.renderToolResultMessage(output, [], {
      theme: defaultToolRenderTheme,
      tools,
      verbose: true,
      input,
    }))
  } catch {
    logForDebugging(`Error rendering tool result message for ${tool.name}`, { level: 'error' })
    return null
  }
}
