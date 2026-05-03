import { glob } from './src/utils/glob.js'

async function testGlob() {
  const cwd = process.cwd()
  const signal = new AbortController().signal

  console.log(`\nTesting glob in: ${cwd}\n`)

  // Test 1: match all .ts files
  console.log('--- Test 1: *.ts ---')
  const tsFiles = await glob('**/*.ts', cwd, { limit: 10, offset: 0 }, signal)
  console.log(`Found ${tsFiles.files.length} files (truncated: ${tsFiles.truncated})`)
  tsFiles.files.forEach(f => console.log('  ', f))

  // Test 2: match .json files in src
  console.log('\n--- Test 2: src/**/*.json ---')
  const jsonFiles = await glob('src/**/*.json', cwd, { limit: 10, offset: 0 }, signal)
  console.log(`Found ${jsonFiles.files.length} files (truncated: ${jsonFiles.truncated})`)
  jsonFiles.files.forEach(f => console.log('  ', f))

  // Test 3: match package.json specifically
  console.log('\n--- Test 3: package.json ---')
  const pkg = await glob('package.json', cwd, { limit: 5, offset: 0 }, signal)
  console.log(`Found ${pkg.files.length} files`)
  pkg.files.forEach(f => console.log('  ', f))

  // Test 4: offset and limit
  console.log('\n--- Test 4: src/**/*.ts with offset=2 limit=3 ---')
  const limited = await glob('src/**/*.ts', cwd, { limit: 3, offset: 2 }, signal)
  console.log(`Found ${limited.files.length} files (truncated: ${limited.truncated})`)
  limited.files.forEach(f => console.log('  ', f))

  // Test 5: absolute path pattern
  console.log('\n--- Test 5: absolute path pattern ---')
  const absPattern = cwd + '/src/utils/*.ts'
  const absResult = await glob(absPattern, cwd, { limit: 10, offset: 0 }, signal)
  console.log(`Found ${absResult.files.length} files`)
  absResult.files.forEach(f => console.log('  ', f))

  // Test 6: no match
  console.log('\n--- Test 6: *.nonexistent ---')
  const none = await glob('*.nonexistent', cwd, { limit: 5, offset: 0 }, signal)
  console.log(`Found ${none.files.length} files (truncated: ${none.truncated})`)

  console.log('\nAll tests done.')
}

testGlob().catch(console.error)
