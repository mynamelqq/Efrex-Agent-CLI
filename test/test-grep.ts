import { setup } from '../src/setup.js'
import { GrepTool } from '../src/tools/GrepTool/GrepTool.js'
import type { ToolUseContext } from '../src/Tool.js'

async function callGrep(args: Parameters<typeof GrepTool.call>[0]) {
  const abortController = new AbortController()
  const context: ToolUseContext = {
    options: { debug: false, verbose: false },
    abortController,
  }

  return GrepTool.call(args, context)
}

function printFiles(files: string[]) {
  files.forEach(file => console.log('  ', file))
}

function printContent(content: string | undefined) {
  if (!content) return
  const lines = content.split('\n')
  lines.forEach(line => console.log('  ', line))
}

async function testGrep() {
  setup()
  const cwd = process.cwd()

  console.log(`\nTesting grep in: ${cwd}\n`)

  console.log('--- Test 1: files_with_matches for GlobTool ---')
  const filesWithMatches = await callGrep({
    pattern: 'GlobTool',
    glob: '**/*.ts',
    output_mode: 'files_with_matches',
    head_limit: 10,
  })
  console.log(`Found ${filesWithMatches.data.numFiles} files`)
  printFiles(filesWithMatches.data.filenames)

  console.log('\n--- Test 2: content mode with line numbers ---')
  const content = await callGrep({
    pattern: 'export function',
    path: 'src',
    glob: '**/*.ts',
    output_mode: 'content',
    '-n': true,
    head_limit: 8,
  })
  console.log(`Found ${content.data.numLines ?? 0} lines`)
  printContent(content.data.content)

  console.log('\n--- Test 3: count mode ---')
  const count = await callGrep({
    pattern: 'import',
    path: 'src',
    glob: '**/*.ts',
    output_mode: 'count',
    head_limit: 8,
  })
  console.log(`Found ${count.data.numMatches ?? 0} matches in ${count.data.numFiles} files`)
  printContent(count.data.content)

  console.log('\n--- Test 4: case-insensitive search ---')
  const caseInsensitive = await callGrep({
    pattern: 'greptool',
    path: 'src/tools',
    glob: '**/*.ts',
    output_mode: 'files_with_matches',
    '-i': true,
    head_limit: 10,
  })
  console.log(`Found ${caseInsensitive.data.numFiles} files`)
  printFiles(caseInsensitive.data.filenames)

  console.log('\n--- Test 5: no matches ---')
  const noMatchPattern = 'definitely_no_such_symbol_' + '12345'
  const none = await callGrep({
    pattern: noMatchPattern,
    glob: '**/*.ts',
    output_mode: 'files_with_matches',
    head_limit: 10,
  })
  console.log(`Found ${none.data.numFiles} files`)

  console.log('\nAll tests done.')
}

testGrep().catch(error => {
  console.error(error)
  process.exitCode = 1
})
