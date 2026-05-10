import { WebSearchTool } from '../src/tools/WebSearchTool/WebSearchTool.js'
import type { ToolUseContext } from '../src/Tool.js'

type Args = {
  query: string
  limit: number
  category: 'web' | 'news' | 'images'
  tbs: string
  live: boolean
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const live = args.includes('--live')
  const filtered = args.filter(arg => arg !== '--live')

  return {
    query: filtered[0] ?? 'firecrawl updates',
    limit: Number(filtered[1] ?? 5),
    category: (filtered[2] ?? 'news') as Args['category'],
    tbs: filtered[3] ?? 'sbd:1,qdr:w',
    live,
  }
}

function createToolContext(abortController: AbortController): ToolUseContext {
  return {
    abortController,
    options: {
      debug: true,
      verbose: true,
      mainLoopModel: 'test',
      tools: [],
      isNonInteractiveSession: true,
    },
    readFileState: {} as ToolUseContext['readFileState'],
    updateFileHistoryState: () => {},
  }
}

function printResults(results: Awaited<ReturnType<typeof WebSearchTool.call>>) {
  console.log(`Query:    ${results.data.query}`)
  console.log(`Duration: ${results.data.durationSeconds.toFixed(3)}s`)
  console.log(`Results:  ${results.data.results.length}`)

  results.data.results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.title}`)
    console.log(`   ${result.url}`)
    if (result.description) {
      console.log(`   ${result.description}`)
    }
    if (result.source) {
      console.log(`   source=${result.source}`)
    }
  })
}

async function testSchema(): Promise<void> {
  console.log('\n--- Schema ---')

  const valid = WebSearchTool.inputSchema.safeParse({
    query: 'firecrawl updates',
    limit: 5,
    category: 'news',
    tbs: 'sbd:1,qdr:w',
  })
  console.log(`Accepts limit/category/tbs: ${valid.success}`)

  const rejectsDomains = WebSearchTool.inputSchema.safeParse({
    query: 'firecrawl updates',
    allowed_domains: ['docs.firecrawl.dev'],
  })
  console.log(`Rejects domain fields:      ${!rejectsDomains.success}`)

  const rejectsLargeLimit = WebSearchTool.inputSchema.safeParse({
    query: 'firecrawl updates',
    limit: 100,
  })
  console.log(`Rejects large limit:        ${!rejectsLargeLimit.success}`)
}

async function testMockedCall(args: Args): Promise<void> {
  console.log('\n--- WebSearchTool.call mocked ---')

  const originalFetch = globalThis.fetch
  const originalApiKey = process.env.FIRECRAWL_API_KEY
  let capturedBody: unknown

  process.env.FIRECRAWL_API_KEY = 'fc-test-key'
  globalThis.fetch = (async (_url, init) => {
    capturedBody =
      typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          news: [
            {
              title: 'Firecrawl update',
              url: 'https://example.com/firecrawl-update',
              description: 'A mocked Firecrawl news result.',
              position: 1,
            },
          ],
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    )
  }) as typeof fetch

  try {
    const abortController = new AbortController()
    const result = await WebSearchTool.call(
      {
        query: args.query,
        limit: args.limit,
        category: args.category,
        tbs: args.tbs,
      },
      createToolContext(abortController),
    )

    console.log('Request body:')
    console.log(JSON.stringify(capturedBody, null, 2))
    printResults(result)
  } finally {
    globalThis.fetch = originalFetch
    if (originalApiKey === undefined) {
      delete process.env.FIRECRAWL_API_KEY
    } else {
      process.env.FIRECRAWL_API_KEY = originalApiKey
    }
  }
}

async function testMissingApiKey(): Promise<void> {
  console.log('\n--- Missing API key ---')

  const originalApiKey = process.env.FIRECRAWL_API_KEY
  delete process.env.FIRECRAWL_API_KEY

  try {
    const abortController = new AbortController()
    await WebSearchTool.call(
      { query: 'firecrawl updates' },
      createToolContext(abortController),
    )
    console.log('Missing API key rejected: false')
  } catch (error) {
    console.log(`Missing API key rejected: ${error instanceof Error}`)
    if (error instanceof Error) {
      console.log(`Message: ${error.message}`)
    }
  } finally {
    if (originalApiKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalApiKey
    }
  }
}

async function testLiveCall(args: Args): Promise<void> {
  console.log('\n--- WebSearchTool.call live ---')

  const abortController = new AbortController()
  const result = await WebSearchTool.call(
    {
      query: args.query,
      limit: args.limit,
      category: args.category,
      tbs: args.tbs,
    },
    createToolContext(abortController),
  )

  printResults(result)
}

async function main(): Promise<void> {
  const args = parseArgs()

  console.log(`Testing WebSearch with query: ${args.query}`)
  console.log(`limit=${args.limit} category=${args.category} tbs=${args.tbs}`)

  await testSchema()
  await testMockedCall(args)
  await testMissingApiKey()

  if (args.live) {
    await testLiveCall(args)
  } else {
    console.log('\nTip: add --live to call the Firecrawl API with FIRECRAWL_API_KEY.')
  }
}

main().catch(error => {
  console.error('\nWebSearch test failed:')
  console.error(error)
  process.exitCode = 1
})
