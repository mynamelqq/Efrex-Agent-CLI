import { WebFetchTool } from '../src/tools/WebFetchTool/WebFetchTool.js'
import {
  clearWebFetchCache,
  getURLMarkdownContent,
} from '../src/tools/WebFetchTool/utils.js'
import type { ToolUseContext } from '../src/Tool.js'

type Args = {
  url: string
  prompt: string
  useTool: boolean
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const useTool = args.includes('--tool')
  const filtered = args.filter(arg => arg !== '--tool')

  return {
    url: filtered[0] ?? 'https://www.typescriptlang.org/docs/',
    prompt: filtered[1] ?? 'Summarize this page in 3 short bullet points.',
    useTool,
  }
}

function preview(value: string, maxLength = 800): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
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

async function testFetchUtility(url: string): Promise<void> {
  console.log('\n--- getURLMarkdownContent ---')

  const abortController = new AbortController()
  const result = await getURLMarkdownContent(url, abortController)

  if ('type' in result && result.type === 'redirect') {
    console.log(`Redirect: ${result.statusCode}`)
    console.log(`Original: ${result.originalUrl}`)
    console.log(`Target:   ${result.redirectUrl}`)
    return
  }

  console.log(`Status:       ${result.code} ${result.codeText}`)
  console.log(`Bytes:        ${result.bytes}`)
  console.log(`Content-Type: ${result.contentType || '(missing)'}`)
  if (result.persistedPath) {
    console.log(`Saved file:   ${result.persistedPath}`)
    console.log(`Saved bytes:  ${result.persistedSize ?? result.bytes}`)
  }
  console.log('\nContent preview:')
  console.log(preview(result.content))
}

async function testWebFetchTool(url: string, prompt: string): Promise<void> {
  console.log('\n--- WebFetchTool.call ---')

  const abortController = new AbortController()
  const result = await WebFetchTool.call(
    { url, prompt },
    createToolContext(abortController),
  )

  console.log(`Status:     ${result.data.code} ${result.data.codeText}`)
  console.log(`Bytes:      ${result.data.bytes}`)
  console.log(`Duration:   ${result.data.durationMs}ms`)
  console.log(`URL:        ${result.data.url}`)
  console.log('\nTool result preview:')
  console.log(preview(result.data.result, 1200))
}

async function main(): Promise<void> {
  const { url, prompt, useTool } = parseArgs()

  clearWebFetchCache()
  console.log(`Testing WebFetch with URL: ${url}`)
  console.log(`User-Agent override: ${process.env.CHATUI_WEBFETCH_USER_AGENT ?? '(default)'}`)

  await testFetchUtility(url)

  if (useTool) {
    await testWebFetchTool(url, prompt)
  } else {
    console.log('\nTip: add --tool to test WebFetchTool.call with the small model.')
  }
}

main().catch(error => {
  console.error('\nWebFetch test failed:')
  console.error(error)
  process.exitCode = 1
})
