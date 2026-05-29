import type { ChatCompletionTool } from 'openai/resources/chat/completions/completions.mjs'
import { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta.mjs'
export type OpenAIToolSchema = {
  type?: string
  name: string
  description?: string
  input_schema?: Record<string, unknown>
  defer_loading?: boolean
  cache_control?: Record<string, unknown>
}

export function toolsToOpenAI(tools: BetaToolUnion[]): ChatCompletionTool[] {
return tools
    .filter(tool => {
      // Only convert standard tools (skip server tools like computer_use, etc.)
      const toolType = (tool as unknown as { type?: string }).type
      return (
        tool.type === 'custom' || !('type' in tool) || toolType !== 'server'
      )
    })
    .map(tool => {
      // Handle the various tool shapes from Anthropic SDK
      const anyTool = tool as unknown as Record<string, unknown>
      const name = (anyTool.name as string) || ''
      const description = (anyTool.description as string) || ''
      const inputSchema = anyTool.input_schema as
        | Record<string, unknown>
        | undefined

      return {
        type: 'function' as const,
        function: {
          name,
          description,
          parameters: sanitizeJsonSchema(
            inputSchema || { type: 'object', properties: {} },
          ),
        },
      } satisfies ChatCompletionTool
    })
}

export function toolChoiceToOpenAI(
  toolChoice: unknown,
): string | { type: 'function'; function: { name: string } } | undefined {
  if (!toolChoice || typeof toolChoice !== 'object') return undefined

  const tc = toolChoice as Record<string, unknown>
  switch (tc.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'tool':
      return typeof tc.name === 'string'
        ? { type: 'function', function: { name: tc.name } }
        : undefined
    default:
      return undefined
  }
}

function sanitizeJsonSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return schema

  const result = { ...schema }
  if ('const' in result) {
    result.enum = [result.const]
    delete result.const
  }

  for (const key of [
    'properties',
    'definitions',
    '$defs',
    'patternProperties',
  ]) {
    const nested = result[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      result[key] = Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).map(([k, v]) => [
          k,
          v && typeof v === 'object' && !Array.isArray(v)
            ? sanitizeJsonSchema(v as Record<string, unknown>)
            : v,
        ]),
      )
    }
  }

  for (const key of [
    'items',
    'additionalProperties',
    'not',
    'if',
    'then',
    'else',
    'contains',
    'propertyNames',
  ]) {
    const nested = result[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      result[key] = sanitizeJsonSchema(nested as Record<string, unknown>)
    }
  }

  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const nested = result[key]
    if (Array.isArray(nested)) {
      result[key] = nested.map(item =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeJsonSchema(item as Record<string, unknown>)
          : item,
      )
    }
  }

  return result
}
