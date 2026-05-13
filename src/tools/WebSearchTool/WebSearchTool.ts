import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getChatUICliUserAgent } from '../../utils/http.js'
import { WEB_SEARCH_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
} from './UI.js'

const FIRECRAWL_SEARCH_URL =
  process.env.FIRECRAWL_SEARCH_URL ?? 'https://api.firecrawl.dev/v2/search'
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20

const categorySchema = z.enum(['web', 'news', 'images'])

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(2).describe('The search query to use'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_LIMIT)
      .optional()
      .describe('Maximum number of search results to return'),
    category: categorySchema
      .optional()
      .describe('Search category/source to use: web, news, or images'),
    tbs: z
      .string()
      .optional()
      .describe(
        'Google-style time filter passed to Firecrawl, such as qdr:w, sbd:1,qdr:w, or cdr:1,cd_min:12/1/2024,cd_max:12/31/2024',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export type Input = z.infer<InputSchema>

const searchHitSchema = lazySchema(() =>
  z.object({
    title: z.string().describe('The title of the search result'),
    url: z.string().describe('The URL of the search result'),
    description: z.string()
      .optional()
      .describe('Description or snippet from the search result'),
    source: z.string().optional().describe('Firecrawl result source'),
    position: z.number().optional().describe('Search result position'),
  }),
)

export type SearchHit = z.infer<ReturnType<typeof searchHitSchema>>

const outputSchema = lazySchema(() =>
  z.object({
    query: z.string().describe('The query that was executed'),
    results: z.array(searchHitSchema()).describe('Search results'),
    durationSeconds: z.number()
      .describe('Time taken to complete the search operation'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

type FirecrawlSearchResult = {
  title?: unknown
  url?: unknown
  description?: unknown
  snippet?: unknown
  position?: unknown
}

type FirecrawlSearchResponse = {
  success?: boolean
  data?: unknown
  error?: unknown
}

function getFirecrawlApiKey(): string | undefined {
  const value = 'fc-2743a74105cd4c5bbc0c8e971ea0b4ab'
  return value ? value : undefined
}

function flattenFirecrawlData(data: unknown): SearchHit[] {
  const hits: SearchHit[] = []

  const addHit = (source: string, result: FirecrawlSearchResult) => {
    if (typeof result.url !== 'string' || !result.url) {
      return
    }

    hits.push({
      title:
        typeof result.title === 'string' && result.title
          ? result.title
          : result.url,
      url: result.url,
      description:
        typeof result.description === 'string'
          ? result.description
          : typeof result.snippet === 'string'
            ? result.snippet
            : undefined,
      source,
      position:
        typeof result.position === 'number' ? result.position : undefined,
    })
  }

  if (Array.isArray(data)) {
    data.forEach(result => addHit('web', result as FirecrawlSearchResult))
    return hits
  }

  if (!data || typeof data !== 'object') {
    return hits
  }

  Object.entries(data as Record<string, unknown>).forEach(
    ([source, sourceResults]) => {
      if (!Array.isArray(sourceResults)) {
        return
      }

      sourceResults.forEach(result =>
        addHit(source, result as FirecrawlSearchResult),
      )
    },
  )

  return hits
}

async function searchFirecrawl(
  input: Input,
  signal: AbortSignal,
): Promise<SearchHit[]> {
  const apiKey = getFirecrawlApiKey()
  if (!apiKey) {
    throw new Error('FIRECRAWL_API_KEY is required to use WebSearch')
  }

  const body: Record<string, unknown> = {
    query: input.query,
    limit: input.limit ?? DEFAULT_LIMIT,
    sources: [input.category ?? 'web'],
  }

  if (input.tbs?.trim()) {
    body.tbs = input.tbs.trim()
  }

  const response = await fetch(FIRECRAWL_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': `${getChatUICliUserAgent()} WebSearch`,
    },
    body: JSON.stringify(body),
    signal,
  })

  const text = await response.text()
  let payload: FirecrawlSearchResponse
  try {
    payload = JSON.parse(text) as FirecrawlSearchResponse
  } catch {
    throw new Error(
      `Firecrawl search returned non-JSON response (${response.status} ${response.statusText})`,
    )
  }

  if (!response.ok || payload.success === false) {
    const error =
      typeof payload.error === 'string' ? payload.error : response.statusText
    throw new Error(`Firecrawl search failed: ${error}`)
  }

  return flattenFirecrawlData(payload.data)
}

export const WebSearchTool = buildTool({
  name: WEB_SEARCH_TOOL_NAME,
  searchHint: 'search the web for current information',
  maxResultSizeChars: 100_000,
  async description(input) {
    return `Claude wants to search the web for: ${input.query}`
  },
  userFacingName() {
    return 'Web Search'
  },
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  getToolUseSummary,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async call(input, { abortController }) {
    const startTime = performance.now()
    const results = await searchFirecrawl(input, abortController.signal)
    const durationSeconds = (performance.now() - startTime) / 1000

    return {
      data: {
        query: input.query,
        results,
        durationSeconds,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { query, results } = output

    let formattedOutput = `Web search results for query: "${query}"\n\n`

    if (results.length > 0) {
      formattedOutput += 'Links:\n'
      for (const result of results) {
        formattedOutput += `  - [${result.title}](${result.url})`
        if (result.description) {
          formattedOutput += `: ${result.description}`
        }
        formattedOutput += '\n'
      }
      formattedOutput += '\n'
    } else {
      formattedOutput += 'No links found.\n\n'
    }

    formattedOutput +=
      '\nREMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.'

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: formattedOutput.trim(),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
