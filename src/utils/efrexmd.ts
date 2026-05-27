import ignore from 'ignore'
import memoize from 'lodash/memoize.js'
import { Lexer } from 'marked'
import { getMemoryPath } from './config.js'
import { isSettingSourceEnabled } from './settings/constants.js'
import { fsReadSync, safeResolvePath } from './file.js'
import { findCanonicalGitRoot } from './git.js'
import { parseFrontmatter,splitPathInFrontmatter } from './frontmatterParser.js'
import { readFile } from 'fs/promises'
import { normalizePathForComparison } from './file.js'
import { MemoryType } from './memory/types.js'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  sep,
} from 'path'
import { getCurrentProjectConfig } from './config.js'
import picomatch from 'picomatch'
import {
  getOriginalCwd,
} from '../bootstrap/state.js'
import { logForDebugging } from './debug.js'
import { getEfrexConfigHomeDir, isEnvTruthy } from './envUtils.js'
import { getErrnoCode } from './errors.js'
import { cacheKeys, type FileStateCache } from './fileStateCache.js'
import { findGitRoot } from './git.js'
import { expandPath } from './path.js'
import { pathInWorkingPath } from './permissions/filesystem.js'
import { getInitialSettings } from './settings/settings.js'

// File extensions that are allowed for @include directives
// This prevents binary files (images, PDFs, etc.) from being loaded into memory
const TEXT_FILE_EXTENSIONS = new Set([
  // Markdown and text
  '.md',
  '.txt',
  '.text',
  // Data formats
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  // Web
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  // JavaScript/TypeScript
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  // Python
  '.py',
  '.pyi',
  '.pyw',
  // Ruby
  '.rb',
  '.erb',
  '.rake',
  // Go
  '.go',
  // Rust
  '.rs',
  // Java/Kotlin/Scala
  '.java',
  '.kt',
  '.kts',
  '.scala',
  // C/C++
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.hxx',
  // C#
  '.cs',
  // Swift
  '.swift',
  // Shell
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  // Config
  '.env',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  // Database
  '.sql',
  '.graphql',
  '.gql',
  // Protocol
  '.proto',
  // Frontend frameworks
  '.vue',
  '.svelte',
  '.astro',
  // Templating
  '.ejs',
  '.hbs',
  '.pug',
  '.jade',
  // Other languages
  '.php',
  '.pl',
  '.pm',
  '.lua',
  '.r',
  '.R',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.clj',
  '.cljs',
  '.cljc',
  '.edn',
  '.hs',
  '.lhs',
  '.elm',
  '.ml',
  '.mli',
  '.f',
  '.f90',
  '.f95',
  '.for',
  // Build files
  '.cmake',
  '.make',
  '.makefile',
  '.gradle',
  '.sbt',
  // Documentation
  '.rst',
  '.adoc',
  '.asciidoc',
  '.org',
  '.tex',
  '.latex',
  // Lock files (often text-based)
  '.lock',
  // Misc
  '.log',  '.diff','.patch',
])
export type MemoryFileInfo = {
  path: string
  type: MemoryType
  content: string
  parent?: string // Path of the file that included this one
  globs?: string[] // Glob patterns for file paths this rule applies to
  // True when auto-injection transformed `content` (stripped HTML comments,
  // stripped frontmatter, truncated MEMORY.md) such that it no longer matches
  // the bytes on disk. When set, `rawContent` holds the unmodified disk bytes
  // so callers can cache a `isPartialView` readFileState entry — presence in
  // cache provides dedup + change detection, but Edit/Write still require an
  // explicit Read before proceeding.
  contentDiffersFromDisk?: boolean
  rawContent?: string
}
const MAX_INCLUDE_DEPTH = 5

/**
* 将原始内容解析以提取内容和前缀文件中的通配符模式 
* * @param rawContent 带有前缀文件内容的原始文件内容 * 
* @returns 包含内容和通配符模式的对象（如果没有路径或匹配所有模式，则返回 undefined）
 */
function parseFrontmatterPaths(rawContent: string): {//paths: src/*.{ts,tsx}, docs/**解析文档中的路径
  content: string
  paths?: string[]
} {
  const { frontmatter, content } = parseFrontmatter(rawContent)//从 Markdown 文本中提取 --- 之间的 YAML 内容 将 YAML 解析为 JavaScript 对象

  if (!frontmatter.paths) {
    return { content }
  }

  const patterns = splitPathInFrontmatter(frontmatter.paths)//路径模式解析 (splitPathInFrontmatter & expandBraces)
    .map(pattern => {
      // Remove /** suffix - ignore library treats 'path' as matching both
      // the path itself and everything inside it
      return pattern.endsWith('/**') ? pattern.slice(0, -3) : pattern
    })
    .filter((p: string) => p.length > 0)

  // If all patterns are ** (match-all), treat as no globs (undefined)
  // This means the file applies to all paths
  if (patterns.length === 0 || patterns.every((p: string) => p === '**')) {
    return { content }
  }

  return { content, paths: patterns }
}
/**
* 将原始内存文件内容解析为 MemoryFileInfo 对象。纯函数——不涉及输入/输出操作。 * * 若指定了 includeBasePath
* ，则 @include 路径将在相同的解析过程中进行解析，并与解析后的文件一同返回（因此 processMemoryFile 不需要对相同的内容进行第二次解析）。
 */
function parseMemoryFileContent(//
  rawContent: string,
  filePath: string,
  type: MemoryType,
  includeBasePath?: string,
): { info: MemoryFileInfo | null; includePaths: string[] } {
  // Skip non-text files to prevent loading binary data (images, PDFs, etc.) into memory
  const ext = extname(filePath).toLowerCase()
  if (ext && !TEXT_FILE_EXTENSIONS.has(ext)) {
    logForDebugging(`Skipping non-text file in @include: ${filePath}`)
    return { info: null, includePaths: [] }
  }

  const { content: withoutFrontmatter, paths } =parseFrontmatterPaths(rawContent)

  // Lex once so strip and @include-extract share the same tokens. gfm:false
  // is required by extract (so ~/path doesn't tokenize as strikethrough) and
  // doesn't affect strip (html blocks are a CommonMark rule).
  const hasComment = withoutFrontmatter.includes('<!--')
  const tokens =
    hasComment || includeBasePath !== undefined
      ? new Lexer({ gfm: false }).lex(withoutFrontmatter)
      : undefined

  // Only rebuild via tokens when a comment actually needs stripping —
  // marked normalises \r\n during lex, so round-tripping a CRLF file
  // through token.raw would spuriously flip contentDiffersFromDisk.
  const strippedContent =
    hasComment && tokens
      ? stripHtmlCommentsFromTokens(tokens).content
      : withoutFrontmatter

  const includePaths =
    tokens && includeBasePath !== undefined
      ? extractIncludePathsFromTokens(tokens, includeBasePath)
      : []

  // Truncate MEMORY.md entrypoints to the line AND byte caps
  let finalContent = strippedContent
//   if (type === 'AutoMem' || type === 'TeamMem') {
//     finalContent = truncateEntrypointContent(strippedContent).content
//   }

  // Covers frontmatter strip, HTML comment strip, and MEMORY.md truncation
  const contentDiffersFromDisk = finalContent !== rawContent
  return {
    info: {
      path: filePath,
      type,
      content: finalContent,
      globs: paths,
      contentDiffersFromDisk,
      rawContent: contentDiffersFromDisk ? rawContent : undefined,
    },
    includePaths,
  }
}
/**
 * Recursively processes a memory file and all its @include references
 * Returns an array of MemoryFileInfo objects with includes first, then main file
 */
export async function processMemoryFile(
  filePath: string,
  type: MemoryType,
  processedPaths: Set<string>,
  includeExternal: boolean,
  depth: number = 0,
  parent?: string,
): Promise<MemoryFileInfo[]> {
  // Skip if already processed or max depth exceeded.
  // Normalize paths for comparison to handle Windows drive letter casing
  // differences (e.g., C:\Users vs c:\Users).
  const normalizedPath = normalizePathForComparison(filePath)//
  if (processedPaths.has(normalizedPath) || depth >= MAX_INCLUDE_DEPTH) {//最大深度 如果已经处理过了
    return []
  }
  // Resolve symlink path early for @import resolution
  const { resolvedPath, isSymlink } = safeResolvePath(filePath)//安全解析链接

  processedPaths.add(normalizedPath)
  if (isSymlink) {
    processedPaths.add(normalizePathForComparison(resolvedPath))//增加链接路径
  }

  const { info: memoryFile, includePaths: resolvedIncludePaths } =//返回解析得到的包含的路径
    await safelyReadMemoryFileAsync(filePath, type, resolvedPath)
  if (!memoryFile || !memoryFile.content.trim()) {
    return []
  }

  // Add parent information
  if (parent) {
    memoryFile.parent = parent
  }

  const result: MemoryFileInfo[] = []

  // Add the main file first (parent before children)
  result.push(memoryFile)

  for (const resolvedIncludePath of resolvedIncludePaths) {//遍历每个include路径，去重，然后递归找文件
    const isExternal = !pathInOriginalCwd(resolvedIncludePath)
    if (isExternal && !includeExternal) {
      continue
    }

    // Recursively process included files with this file as parent
    const includedFiles = await processMemoryFile(
      resolvedIncludePath,
      type,
      processedPaths,
      includeExternal,
      depth + 1,
      filePath, // Pass current file as parent
    )
    result.push(...includedFiles)
  }

  return result
}
/**
 * Used by processMemoryFile → getMemoryFiles so the event loop stays
 * responsive during the directory walk (many readFile attempts, most
 * ENOENT). When includeBasePath is given, @include paths are resolved in
 * the same lex pass and returned alongside the parsed file.
 */
async function safelyReadMemoryFileAsync(
  filePath: string,
  type: MemoryType,
  includeBasePath?: string,
): Promise<{ info: MemoryFileInfo | null; includePaths: string[] }> {
  try {
    const rawContent = await readFile(filePath,{ encoding: 'utf-8' })
    return parseMemoryFileContent(rawContent, filePath, type, includeBasePath)
  } catch (error) {
    handleMemoryFileReadError(error, filePath)
    return { info: null, includePaths: [] }
  }
}
export const getMemoryFiles = memoize(
  async (forceIncludeExternal: boolean = false): Promise<MemoryFileInfo[]> => {
    const startTime = Date.now()

    const result: MemoryFileInfo[] = []
    const processedPaths = new Set<string>()
    const config = getCurrentProjectConfig()
    const includeExternal =
      forceIncludeExternal ||
      config.hasClaudeMdExternalIncludesApproved ||
      false


    // Process User file (only if userSettings is enabled)
    if (isSettingSourceEnabled('userSettings')) {
      const userEfrexMd = getMemoryPath('User')
      result.push(
        ...(await processMemoryFile(
          userEfrexMd,
          'User',
          processedPaths,
          true, // User memory can always include external files
        )),
      )
    }

    // Then process Project and Local files
    const dirs: string[] = []
    const originalCwd = getOriginalCwd()
    let currentDir = originalCwd

    while (currentDir !== parse(currentDir).root) {
      dirs.push(currentDir)
      currentDir = dirname(currentDir)
    }

    // When running from a git worktree nested inside its main repo (e.g.,
    // .claude/worktrees/<name>/ from `claude -w`), the upward walk passes
    // through both the worktree root and the main repo root. Both contain
    // checked-in files like CLAUDE.md and .claude/rules/*.md, so the same
    // content gets loaded twice. Skip Project-type (checked-in) files from
    // directories above the worktree but within the main repo — the worktree
    // already has its own checkout. CLAUDE.local.md is gitignored so it only
    // exists in the main repo and is still loaded.
    // See: https://github.com/anthropics/claude-code/issues/29599
    const gitRoot = findGitRoot(originalCwd)
    const canonicalRoot = findCanonicalGitRoot(originalCwd)
    const isNestedWorktree =
      gitRoot !== null &&
      canonicalRoot !== null &&
      normalizePathForComparison(gitRoot) !==
        normalizePathForComparison(canonicalRoot) &&
      pathInWorkingPath(gitRoot, canonicalRoot)

    // Process from root downward to CWD
    for (const dir of dirs.reverse()) {
      // In a nested worktree, skip checked-in files from the main repo's
      // working tree (dirs inside canonicalRoot but outside the worktree).
      const skipProject =
        isNestedWorktree &&
        pathInWorkingPath(dir, canonicalRoot) &&
        !pathInWorkingPath(dir, gitRoot)

      // Try reading CLAUDE.md (Project) - only if projectSettings is enabled
      if (isSettingSourceEnabled('projectSettings') && !skipProject) {
        const projectPath = join(dir, 'Efrex.md')
        result.push(
          ...(await processMemoryFile(
            projectPath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

        // Try reading .claude/CLAUDE.md (Project)
        const dotEfrexPath = join(dir, '.efrex', 'EFREX.md')
        result.push(
          ...(await processMemoryFile(
            dotEfrexPath,
            'Project',
            processedPaths,
            includeExternal,
          )),
        )

      // Try reading CLAUDE.local.md (Local) - only if localSettings is enabled
      if (isSettingSourceEnabled('localSettings')) {
        const localPath = join(dir, 'Efrex.local.md')
        result.push(
          ...(await processMemoryFile(
            localPath,
            'Local',
            processedPaths,
            includeExternal,
          )),
        )
      }
    }

}
    const totalContentLength = result.reduce(
      (sum, f) => sum + f.content.length,
      0,
    )
    const typeCounts: Record<string, number> = {}
    for (const f of result) {
      typeCounts[f.type] = (typeCounts[f.type] ?? 0) + 1
    }

    
  return result
  },
)
function stripHtmlCommentsFromTokens(tokens: ReturnType<Lexer['lex']>): {
  content: string
  stripped: boolean
} {
  let result = ''
  let stripped = false

  // A well-formed HTML comment span. Non-greedy so multiple comments on the
  // same line are matched independently; [\s\S] to span newlines.
  const commentSpan = /<!--[\s\S]*?-->/g

  for (const token of tokens) {
    if (token.type === 'html') {
      const trimmed = token.raw.trimStart()
      if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
        // Per CommonMark, a type-2 HTML block ends at the *line* containing
        // `-->`, so text after `-->` on that line is part of this token.
        // Strip only the comment spans and keep any residual content.
        const residue = token.raw.replace(commentSpan, '')
        stripped = true
        if (residue.trim().length > 0) {
          // Residual content exists (e.g. `<!-- note --> Use bun`): keep it.
          result += residue
        }
        continue
      }
    }
    result += token.raw
  }

  return { content: result, stripped }
}
// Extract @path include references from pre-lexed tokens and resolve to
// absolute paths. Skips html tokens so @paths inside block comments are
// ignored — the caller may pass pre-strip tokens.
function extractIncludePathsFromTokens(
  tokens: ReturnType<Lexer['lex']>,
  basePath: string,
): string[] {
  const absolutePaths = new Set<string>()

  // Extract @paths from a text string and add resolved paths to absolutePaths.
  function extractPathsFromText(textContent: string) {
    const includeRegex = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g
    let match
    while ((match = includeRegex.exec(textContent)) !== null) {
      let path = match[1]
      if (!path) continue

      // Strip fragment identifiers (#heading, #section-name, etc.)
      const hashIndex = path.indexOf('#')
      if (hashIndex !== -1) {
        path = path.substring(0, hashIndex)
      }
      if (!path) continue

      // Unescape the spaces in the path
      path = path.replace(/\\ /g, ' ')

      // Accept @path, @./path, @~/path, or @/path
      if (path) {
        const isValidPath =
          path.startsWith('./') ||
          path.startsWith('~/') ||
          (path.startsWith('/') && path !== '/') ||
          (!path.startsWith('@') &&
            !path.match(/^[#%^&*()]+/) &&
            path.match(/^[a-zA-Z0-9._-]/))

        if (isValidPath) {
          const resolvedPath = expandPath(path, dirname(basePath))
          absolutePaths.add(resolvedPath)
        }
      }
    }
  }

  // Recursively process elements to find text nodes
  function processElements(elements: MarkdownToken[]) {
    for (const element of elements) {
      if (element.type === 'code' || element.type === 'codespan') {
        continue
      }

      // For html tokens that contain comments, strip the comment spans and
      // check the residual for @paths (e.g. `<!-- note --> @./file.md`).
      // Other html tokens (non-comment tags) are skipped entirely.
      if (element.type === 'html') {
        const raw = element.raw || ''
        const trimmed = raw.trimStart()
        if (trimmed.startsWith('<!--') && trimmed.includes('-->')) {
          const commentSpan = /<!--[\s\S]*?-->/g
          const residue = raw.replace(commentSpan, '')
          if (residue.trim().length > 0) {
            extractPathsFromText(residue)
          }
        }
        continue
      }

      // Process text nodes
      if (element.type === 'text') {
        extractPathsFromText(element.text || '')
      }

      // Recurse into children tokens
      if (element.tokens) {
        processElements(element.tokens)
      }

      // Special handling for list structures
      if (element.items) {
        processElements(element.items)
      }
    }
  }

  processElements(tokens as MarkdownToken[])
  return [...absolutePaths]
}
type MarkdownToken = {
  type: string
  text?: string
  href?: string
  tokens?: MarkdownToken[]
  raw?: string
  items?: MarkdownToken[]
}
function pathInOriginalCwd(path: string): boolean {
  return pathInWorkingPath(path, getOriginalCwd())
}
function handleMemoryFileReadError(error: unknown, filePath: string): void {
  const code = getErrnoCode(error)
  // ENOENT = file doesn't exist, EISDIR = is a directory — both expected
  if (code === 'ENOENT' || code === 'EISDIR') {
    return
  }
}