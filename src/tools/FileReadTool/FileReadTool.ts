
import {
  appendFile,
  mkdir,
  readdir,
  readFile as readFileAsync,
  stat
} from 'fs/promises'
import { posix, win32 } from 'path'
import { createUserMessage } from '../../utils/messages'
import { readFileInRange } from '../../utils/readFileInRange'
// import {readFileBytes} from 'fs/promises'
import * as path from 'path'
import { isENOENT } from '../../utils/error'
import { getEfrexConfigHomeDir } from '../../utils/envUtils'
import {
  open
} from 'fs/promises'
import { ToolUseContext } from '../../Tool'
import {
  compressImageBufferWithTokenLimit,
  createImageDataURL,
  createImageMetadataText,
  detectImageFormatFromBuffer,
  type ImageDimensions,
  type ImageMediaType,
  ImageResizeError,
  maybeResizeAndDownsampleImageBuffer,
} from '../../utils/imageResizer.js'
import { findSimilarFile ,suggestPathUnderCwd} from '../../utils/file'
import {
  isPDFExtension,
  parsePDFPageRange,
} from '../../utils/pdfUtils'
import { getErrnoCode } from '../../utils/error'
import { getFileModificationTimeAsync } from '../../utils/file'
import { LOG_PATHS } from '../../utils/logPaths'
import { logError } from '../../utils/logger'
import { userFacingName,getToolUseSummary } from './UI'
import { getDefaultFileReadingLimits } from './limits'
import { ToolDef } from '../../Tool'
import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema'
import { buildTool } from '../../Tool'
import { getCwd } from '../../utils/cwd'
import { FILE_READ_TOOL_NAME,DESCRIPTION } from './prompt'
import {semanticNumber}from "../../utils/semanticNumber"
import { expandPath } from '../../utils/path'
import {PDF_MAX_PAGES_PER_READ,PDF_AT_MENTION_INLINE_THRESHOLD ,PDF_EXTRACT_SIZE_THRESHOLD} from '../../constants/ApiLimits'
const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z.string().describe('The absolute path to the file to read'),
    offset: semanticNumber(z.number().int().nonnegative().optional()).describe(//偏移量
      'The line number to start reading from. Only provide if the file is too large to read at once',
    ),
    limit: semanticNumber(z.number().int().positive().optional()).describe(//最多读多少行
      'The number of lines to read. Only provide if the file is too large to read at once.',
    ),
    pages: z//PDF适用
      .string()
      .optional()
      .describe(
        `Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum ${PDF_MAX_PAGES_PER_READ} pages per request.`,
      ),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
export type Input = z.infer<InputSchema>

function logFileReaderEvent(
  event: string,
  metadata: Record<string, unknown> = {},
): void {
  void (async () => {
    try {
      const debugPath = LOG_PATHS.debug()
      await mkdir(debugPath, { recursive: true })
      await appendFile(
        path.join(debugPath, 'file-reader.log'),
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event,
          metadata,
        }) + '\n',
        'utf8',
      )
    } catch (error) {
      logError(error)
    }
  })()
}

const outputSchema = lazySchema(() => {
  // Define the media types supported for images
  const imageMediaTypes = z.enum([//媒体类型
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ])
  return z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      file: z.object({
        filePath: z.string().describe('The path to the file that was read'),
        content: z.string().describe('The content of the file'),
        numLines: z
          .number()
          .describe('Number of lines in the returned content'),
        startLine: z.number().describe('The starting line number'),
        totalLines: z.number().describe('Total number of lines in the file'),
      }),
    }),
    z.object({
      type: z.literal('image'),//压缩图片
      file: z.object({
        base64: z.string().describe('Base64-encoded image data'),
        type: imageMediaTypes.describe('The MIME type of the image'),
        originalSize: z.number().describe('Original file size in bytes'),
        dimensions: z
          .object({
            originalWidth: z
              .number()
              .optional()
              .describe('Original image width in pixels'),
            originalHeight: z
              .number()
              .optional()
              .describe('Original image height in pixels'),
            displayWidth: z
              .number()
              .optional()
              .describe('Displayed image width in pixels (after resizing)'),
            displayHeight: z
              .number()
              .optional()
              .describe('Displayed image height in pixels (after resizing)'),
          })
          .optional()
          .describe('Image dimension info for coordinate mapping'),
      }),
    }),
    z.object({//notebook
      type: z.literal('notebook'),
      file: z.object({
        filePath: z.string().describe('The path to the notebook file'),
        cells: z.array(z.any()).describe('Array of notebook cells'),
      }),
    }),
    z.object({
      type: z.literal('pdf'),
      file: z.object({
        filePath: z.string().describe('The path to the PDF file'),
        base64: z.string().describe('Base64-encoded PDF data'),
        originalSize: z.number().describe('Original file size in bytes'),
      }),
    }),
    z.object({
      type: z.literal('parts'),
      file: z.object({
        filePath: z.string().describe('The path to the PDF file'),
        originalSize: z.number().describe('Original file size in bytes'),
        count: z.number().describe('Number of pages extracted'),
        outputDir: z
          .string()
          .describe('Directory containing extracted page images'),
      }),
    }),
    z.object({//表示文件没有变化，通常用于增量更新、缓存或变更检测场景。
      type: z.literal('file_unchanged'),
      file: z.object({
        filePath: z.string().describe('The path to the file'),
      }),
    }),
  ])
})
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// Device files that would hang the process: infinite output or blocking input.
// Checked by path only (no I/O). Safe devices like /dev/null are intentionally omitted.
const BLOCKED_DEVICE_PATHS = new Set([
  // Infinite output — never reach EOF
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/full',
  // Blocks waiting for input
  '/dev/stdin',
  '/dev/tty',
  '/dev/console',
  // Nonsensical to read
  '/dev/stdout',
  '/dev/stderr',
  // fd aliases for stdin/stdout/stderr
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2',
])

function isBlockedDevicePath(filePath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(filePath)) return true
  // /proc/self/fd/0-2 and /proc/<pid>/fd/0-2 are Linux aliases for stdio
  if (
    filePath.startsWith('/proc/') &&
    (filePath.endsWith('/fd/0') ||
      filePath.endsWith('/fd/1') ||
      filePath.endsWith('/fd/2'))
  )
    return true
  return false
}

// Narrow no-break space (U+202F) used by some macOS versions in screenshot filenames
const THIN_SPACE = String.fromCharCode(8239)

/**
 * Resolves macOS screenshot paths that may have different space characters.
 * macOS uses either regular space or thin space (U+202F) before AM/PM in screenshot
 * filenames depending on the macOS version. This function tries the alternate space
 * character if the file doesn't exist with the given path.
 *
 * @param filePath - The normalized file path to resolve
 * @returns The path to the actual file on disk (may differ in space character)
 */
/**
 * For macOS screenshot paths with AM/PM, the space before AM/PM may be a
 * regular space or a thin space depending on the macOS version.  Returns
 * the alternate path to try if the original doesn't exist, or undefined.
 */
function getAlternateScreenshotPath(filePath: string): string | undefined {
  const filename = path.basename(filePath)
  const amPmPattern = /^(.+)([ \u202F])(AM|PM)(\.png)$/
  const match = filename.match(amPmPattern)
  if (!match) return undefined

  const currentSpace = match[2]
  const alternateSpace = currentSpace === ' ' ? THIN_SPACE : ' '
  return filePath.replace(
    `${currentSpace}${match[3]}${match[4]}`,
    `${alternateSpace}${match[3]}${match[4]}`,
  )
}

// File read listeners - allows other services to be notified when files are read
type FileReadListener = (filePath: string, content: string) => void
const fileReadListeners: FileReadListener[] = []

export function registerFileReadListener(
  listener: FileReadListener,
): () => void {
  fileReadListeners.push(listener)
  return () => {
    const i = fileReadListeners.indexOf(listener)
    if (i >= 0) fileReadListeners.splice(i, 1)
  }
}

export class MaxFileReadTokenExceededError extends Error {
  constructor(
    public tokenCount: number,
    public maxTokens: number,
  ) {
    super(
      `File content (${tokenCount} tokens) exceeds maximum allowed tokens (${maxTokens}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
    )
    this.name = 'MaxFileReadTokenExceededError'
  }
}

// Common image extensions
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

/**
 * Detects if a file path is a session-related file for analytics logging.
 * Only matches files within the Claude config directory (e.g., ~/.claude).
 * Returns the type of session file or null if not a session file.
 */
function detectSessionFileType(
  filePath: string,
): 'session_memory' | 'session_transcript' | null {
  const configDir = getEfrexConfigHomeDir()

  // Only match files within the Claude config directory
  if (!filePath.startsWith(configDir)) {
    return null
  }

  // Normalize path to use forward slashes for consistent matching across platforms
  const normalizedPath = filePath.split(win32.sep).join(posix.sep)

  // Session memory files: ~/.claude/session-memory/*.md (including summary.md)
  if (
    normalizedPath.includes('/session-memory/') &&
    normalizedPath.endsWith('.md')
  ) {
    return 'session_memory'
  }

  // Session JSONL transcript files: ~/.claude/projects/*/*.jsonl
  if (
    normalizedPath.includes('/projects/') &&
    normalizedPath.endsWith('.jsonl')
  ) {
    return 'session_transcript'
  }

  return null
}

export const FileReadTool = buildTool({
  name: FILE_READ_TOOL_NAME,
  searchHint: 'read files, images, PDFs, notebooks',
  // Output is bounded by maxTokens (validateContentTokens). Persisting to a
  // file the model reads back with Read is circular — never persist.
  maxResultSizeChars: Infinity,
  async description() {
    return DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName,
  getToolUseSummary,
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async call(
    { file_path, offset = 1, limit = undefined, pages },
    context
  ) {
    const { readFileState, fileReadingLimits } = context

    const defaults = getDefaultFileReadingLimits()
    const maxSizeBytes =
      fileReadingLimits?.maxSizeBytes ?? defaults.maxSizeBytes
    const maxTokens = fileReadingLimits?.maxTokens ?? defaults.maxTokens



    const ext = path.extname(file_path).toLowerCase().slice(1)
    // Use expandPath for consistent path normalization with FileEditTool/FileWriteTool
    // (especially handles whitespace trimming and Windows path separators)
    const fullFilePath = expandPath(file_path)
    if (isBlockedDevicePath(fullFilePath)) {
      throw new Error(`Refusing to read blocked device path: ${file_path}`)
    }

// Dedup: 如果我们已经读过【完全一样的文件范围】，并且【文件在磁盘上没被修改过】
// 就直接返回一个【占位 stub】，不要再重新发送完整内容。

// 之前的读取结果还在上下文里 —— 每次都保留两份完整副本
// 会白白浪费缓存创建资源（cache_creation tokens）。

// BQ 代理数据显示：大约 18% 的 Read 调用都是重复读同一个文件
// 占了整体缓存创建量的 2.64%。

// 这个优化只对【文本文件 / 笔记本文件】生效
  // 图片 / PDF 不会被缓存到 readFileState，所以不会触发去重。
// 压力测试结果：2 小时内命中 1734 次去重，没有出现读取错误。
// 紧急开关：如果占位符导致模型出问题，管理员可以立刻关掉这个功能。
// 第三方默认：紧急开关关闭 = 去重功能开启。
// 纯客户端逻辑，不需要服务器支持，兼容各种第三方平台。
    const dedupKillswitch = true
    const existingState = dedupKillswitch//那缓存
      ? undefined
      : readFileState.get(fullFilePath)

// 只有【来自 Read 操作】的记录才能用来去重
// 因为 Read 一定会设置 offset（读取位置）。

// 编辑/写入操作存的是 offset=undefined
// 它们的 readFileState 只记录【编辑后的修改时间】
// 如果拿这些去重，会错误地让模型读到【编辑前的旧内容】。
    if (
      existingState &&
      !existingState.isPartialView &&//没被修改，而且有缓存
      existingState.offset !== undefined// 偏移量存在（来自真正的 Read 操作）
    ) {
      const rangeMatch =
        existingState.offset === offset && existingState.limit === limit
      if (rangeMatch) {//offset和limit都一样，说明读的范围完全一样
        try {
          const mtimeMs = await getFileModificationTimeAsync(fullFilePath)//继续检查文件的更新时间
          if (mtimeMs === existingState.timestamp) {//更新时间一样
            // const analyticsExt = getFileExtensionForAnalytics(fullFilePath)//我们就不分析文件扩展名了
            // logFileReaderEvent('tengu_file_read_dedup', {
            //   ...(analyticsExt !== undefined && { ext: analyticsExt }),
            // })
            return {
              data: {
                type: 'file_unchanged' as const,
                file: { filePath: file_path },
              },
            }
          }
        } catch {
          // stat failed — fall through to full read
        }
      }
    }

    // Discover skills from this file's path (fire-and-forget, non-blocking)
    // Skip in simple mode - no skills available
    const cwd = getCwd()//举例：如果你读了一个 .tsx 文件，可能触发 React/前端相关 skill；
    // if (!isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    //   const newSkillDirs = await discoverSkillDirsForPaths([fullFilePath], cwd)
    //   if (newSkillDirs.length > 0) {
    //     // Store discovered dirs for attachment display
    //     for (const dir of newSkillDirs) {
    //       context.dynamicSkillDirTriggers?.add(dir)
    //     }
    //     // Don't await - let skill loading happen in the background
    //     addSkillDirectories(newSkillDirs).catch(() => {})
    //   }

    //   // Activate conditional skills whose path patterns match this file
    //   activateConditionalSkillsForPaths([fullFilePath], cwd)
    // }

    try {
      return await callInner(
        file_path,
        fullFilePath,
        fullFilePath,
        ext,
        offset,
        limit,
        pages,
        maxSizeBytes,
        maxTokens,
        readFileState,
        context
      )
    } catch (error) {
      // Handle file-not-found: suggest similar files
      const code = getErrnoCode(error)
      if (code === 'ENOENT') {
        // macOS screenshots may use a thin space or regular space before
        // AM/PM — try the alternate before giving up.
        const altPath = getAlternateScreenshotPath(fullFilePath)
        if (altPath) {
          try {
            return await callInner(
              file_path,
              fullFilePath,
              altPath,
              ext,
              offset,
              limit,
              pages,
              maxSizeBytes,
              maxTokens,
              readFileState,
              context
            )
          } catch (altError) {
            if (!isENOENT(altError)) {
              throw altError
            }
            // Alt path also missing — fall through to friendly error
          }
        }

        const similarFilename = findSimilarFile(fullFilePath)
        const cwdSuggestion = await suggestPathUnderCwd(fullFilePath)
        let message = `File does not exist. Note: your current working directory is ${getCwd()}.`
        if (cwdSuggestion) {
          message += ` Did you mean ${cwdSuggestion}?`
        } else if (similarFilename) {
          message += ` Did you mean ${similarFilename}?`
        }
        throw new Error(message)
      }
      throw error
    }
  },
} satisfies ToolDef<InputSchema, Output>)



export const CYBER_RISK_MITIGATION_REMINDER =
  '\n\n<system-reminder>\nWhenever you read a file, you should consider whether it would be considered malware. You CAN and SHOULD provide analysis of malware, what it is doing. But you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer questions about the code behavior.\n</system-reminder>\n'

// Models where cyber risk mitigation should be skipped
const MITIGATION_EXEMPT_MODELS = new Set(['claude-opus-4-6'])

/**
 * Side-channel from call() to mapToolResultToToolResultBlockParam: mtime
 * of auto-memory files, keyed by the `data` object identity. Avoids
 * adding a presentation-only field to the output schema (which flows
 * into SDK types) and avoids sync fs in the mapper. WeakMap auto-GCs
 * when the data object becomes unreachable after rendering.
 */
const memoryFileMtimes = new WeakMap<object, number>()


async function validateContentTokens(
  content: string,
  ext: string,
  maxTokens?: number,
): Promise<void> {
  const effectiveMaxTokens =
    maxTokens ?? getDefaultFileReadingLimits().maxTokens

  const tokenEstimate = roughTokenCountEstimationForFileType(content, ext)
  if (tokenEstimate > effectiveMaxTokens) {
    throw new MaxFileReadTokenExceededError(tokenEstimate, effectiveMaxTokens)
  }
}

function roughTokenCountEstimationForFileType(
  content: string,
  ext: string,
): number {
  if (!content) return 0

  const byteLength = Buffer.byteLength(content, 'utf8')
  const cjkChars = content.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const asciiWords = content.match(/[A-Za-z0-9_]+/g)?.length ?? 0
  const symbolRuns = content.match(/[^\sA-Za-z0-9_\u3400-\u9fff\uf900-\ufaff]+/g)
    ?.length ?? 0

  const isCode = new Set([
    'js',
    'jsx',
    'ts',
    'tsx',
    'json',
    'css',
    'html',
    'xml',
    'py',
    'rs',
    'go',
    'java',
    'c',
    'cpp',
    'h',
    'hpp',
    'cs',
    'php',
    'rb',
    'sh',
    'ps1',
    'sql',
    'yaml',
    'yml',
    'toml',
  ]).has(ext)

  const byteEstimate = Math.ceil(byteLength / (isCode ? 3.2 : 4))
  const lexicalEstimate = Math.ceil(asciiWords * 1.35 + cjkChars + symbolRuns)
  return Math.max(byteEstimate, lexicalEstimate)
}

type ImageResult = {
  type: 'image'
  file: {
    base64: string
    type: ImageMediaType
    originalSize: number
    dimensions?: ImageDimensions
  }
}

function createImageResponse(
  buffer: Buffer,
  mediaType: string,
  originalSize: number,
  dimensions?: ImageDimensions,
): ImageResult {
  return {
    type: 'image',
    file: {
      base64: buffer.toString('base64'),
      type: `image/${mediaType}` as ImageMediaType,
      originalSize,
      dimensions,
    },
  }
}

/**
 * 内部呼叫实现分离，以便在外部呼叫中进行 ENOENT 处理。
 */
async function callInner(
  file_path: string,
  fullFilePath: string,
  resolvedFilePath: string,
  ext: string,
  offset: number,
  limit: number | undefined,
  pages: string | undefined,
  maxSizeBytes: number,
  maxTokens: number,
  readFileState: ToolUseContext['readFileState'],
  context: ToolUseContext,
  // messageId: string | undefined,
): Promise<{
  data: Output
  newMessages?: ReturnType<typeof createUserMessage>[]
}> {
  // --- Notebook ---
  // if (ext === 'ipynb') {//ipynb
  //   const cells = await readNotebook(resolvedFilePath)
  //   const cellsJson = jsonStringify(cells)

  //   const cellsJsonBytes = Buffer.byteLength(cellsJson)
  //   if (cellsJsonBytes > maxSizeBytes) {
  //     throw new Error(
  //       `Notebook content (${formatFileSize(cellsJsonBytes)}) exceeds maximum allowed size (${formatFileSize(maxSizeBytes)}). ` +
  //         `Use ${BASH_TOOL_NAME} with jq to read specific portions:\n` +
  //         `  cat "${file_path}" | jq '.cells[:20]' # First 20 cells\n` +
  //         `  cat "${file_path}" | jq '.cells[100:120]' # Cells 100-120\n` +
  //         `  cat "${file_path}" | jq '.cells | length' # Count total cells\n` +
  //         `  cat "${file_path}" | jq '.cells[] | select(.cell_type=="code") | .source' # All code sources`,
  //     )
  //   }

    // await validateContentTokens(cellsJson, ext, maxTokens)

  //   // Get mtime via async stat (single call, no prior existence check)
  //   const stats = await getFsImplementation().stat(resolvedFilePath)
  //   readFileState.set(fullFilePath, {
  //     content: cellsJson,
  //     timestamp: Math.floor(stats.mtimeMs),
  //     offset,
  //     limit,
  //   })
  //   context.nestedMemoryAttachmentTriggers?.add(fullFilePath)

  //   const data = {
  //     type: 'notebook' as const,
  //     file: { filePath: file_path, cells },
  //   }

  //   logFileOperation({
  //     operation: 'read',
  //     tool: 'FileReadTool',
  //     filePath: fullFilePath,
  //     content: cellsJson,
  //   })

  //   return { data }
  // }

  // --- Image (single read, no double-read) ---
  if (IMAGE_EXTENSIONS.has(ext)) {
    // Images have their own size limits (token budget + compression) —
    // don't apply the text maxSizeBytes cap.
    const data = await readImageWithTokenBudget(resolvedFilePath, maxTokens)
    // context.nestedMemoryAttachmentTriggers?.add(fullFilePath)

    const metadataText = data.file.dimensions
      ? createImageMetadataText(data.file.dimensions)
      : null

    return {
      data,
      ...(metadataText && {
        newMessages: [
          createUserMessage({ content: metadataText, isMeta: true }),
        ],
      }),
    }
  }

  // --- PDF ---
  if (isPDFExtension(ext)) {
    const { extractPDFPages, getPDFPageCount, readPDF } = await import(
      '../../utils/pdf.js'
    )
    if (pages) {
      const parsedRange = parsePDFPageRange(pages)
      const extractResult = await extractPDFPages(
        resolvedFilePath,
        parsedRange ?? undefined,
      )
      if (!extractResult.success) {
        throw new Error(extractResult.error.message)
      }

      const entries = await readdir(extractResult.data.file.outputDir)
      const imageFiles = entries.filter(f => f.endsWith('.jpg')).sort()
      const imageBlocks = await Promise.all(
        imageFiles.map(async f => {
          const imgPath = path.join(extractResult.data.file.outputDir, f)
          const imgBuffer = await readFileAsync(imgPath)
          const resized = await maybeResizeAndDownsampleImageBuffer(
            imgBuffer,
            imgBuffer.length,
            'jpeg',
          )
          return {
            type: 'image_url' as const,
            image_url: {
              url: createImageDataURL(
                `image/${resized.mediaType}` as ImageMediaType,
                resized.buffer.toString('base64'),
              ),
            },
          }
        }),
      )
      return {
        data: extractResult.data,
        ...(imageBlocks.length > 0 && {
          newMessages: [
            createUserMessage({ content: imageBlocks, isMeta: true }),
          ],
        }),
      }
    }

    const pageCount = await getPDFPageCount(resolvedFilePath)
    if (pageCount !== null && pageCount > PDF_AT_MENTION_INLINE_THRESHOLD) {
      throw new Error(
        `This PDF has ${pageCount} pages, which is too many to read at once. ` +
          `Use the pages parameter to read specific page ranges (e.g., pages: "1-5"). ` +
          `Maximum ${PDF_MAX_PAGES_PER_READ} pages per request.`,
      )
    }
    const stats = await stat(resolvedFilePath)
    const shouldExtractPages =
       stats.size > PDF_EXTRACT_SIZE_THRESHOLD

    if (shouldExtractPages) {
      const extractResult = await extractPDFPages(resolvedFilePath)
      if (!extractResult.success) {
        throw new Error(extractResult.error.message)
      }

      const entries = await readdir(extractResult.data.file.outputDir)
      const imageFiles = entries.filter(f => f.endsWith('.jpg')).sort()
      const imageBlocks = await Promise.all(
        imageFiles.map(async f => {
          const imgPath = path.join(extractResult.data.file.outputDir, f)
          const imgBuffer = await readFileAsync(imgPath)
          const resized = await maybeResizeAndDownsampleImageBuffer(
            imgBuffer,
            imgBuffer.length,
            'jpeg',
          )
          return {
            type: 'image_url' as const,
            image_url: {
              url: createImageDataURL(
                `image/${resized.mediaType}` as ImageMediaType,
                resized.buffer.toString('base64'),
              ),
            },
          }
        }),
      )

      return {
        data: extractResult.data,
        ...(imageBlocks.length > 0 && {
          newMessages: [
            createUserMessage({ content: imageBlocks, isMeta: true }),
          ],
        }),
      }
    }

    const readResult = await readPDF(resolvedFilePath)
    if (!readResult.success) {
      throw new Error(readResult.error.message)
    }
    const pdfData = readResult.data


    return {
      data: pdfData,
      newMessages: [
        createUserMessage({
          content: [
            {
              type: 'file',
              file: {
                filename: path.basename(file_path),
                file_data: `data:application/pdf;base64,${pdfData.file.base64}`,
              },
            },
          ],
          isMeta: true,
        }),
      ],
    }
  }

  // --- Text file (single async read via readFileInRange) ---
  const lineOffset = offset === 0 ? 0 : offset - 1
  const { content, lineCount, totalLines, totalBytes, readBytes, mtimeMs } =
    await readFileInRange(
      resolvedFilePath,
      lineOffset,
      limit,
      limit === undefined ? maxSizeBytes : undefined,
      context.abortController.signal,
    )

  await validateContentTokens(content, ext, maxTokens)

  readFileState.set(fullFilePath, {
    content,
    timestamp: Math.floor(mtimeMs),
    offset,
    limit,
  })
  // context.nestedMemoryAttachmentTriggers?.add(fullFilePath)

  // Snapshot before iterating — a listener that unsubscribes mid-callback
  // would splice the live array and skip the next listener.
  for (const listener of fileReadListeners.slice()) {
    listener(resolvedFilePath, content)
  }

  const data = {
    type: 'text' as const,
    file: {
      filePath: file_path,
      content,
      numLines: lineCount,
      startLine: offset,
      totalLines,
    },
  }


  const sessionFileType = detectSessionFileType(fullFilePath)

  return { data }
}

/**
 * Reads an image file and applies token-based compression if needed.
 * Reads the file ONCE, then applies standard resize. If the result exceeds
 * the token limit, applies aggressive compression from the same buffer.
 *
 * @param filePath - Path to the image file
 * @param maxTokens - Maximum token budget for the image
 * @returns Image data with appropriate compression applied
 */
export async function readImageWithTokenBudget(
  filePath: string,
  maxTokens: number = getDefaultFileReadingLimits().maxTokens,
  maxBytes?: number,
): Promise<ImageResult>{
  // Read file ONCE — capped to maxBytes to avoid OOM on huge files
  const imageBuffer = await readFileBytes(
    filePath,
    maxBytes,
  )
  const originalSize = imageBuffer.length

  if (originalSize === 0) {
    throw new Error(`Image file is empty: ${filePath}`)
  }

  const detectedMediaType = detectImageFormatFromBuffer(imageBuffer)
  const detectedFormat = detectedMediaType.split('/')[1] || 'png'

  // Try standard resize
  let result: ImageResult
  try {
    const resized = await maybeResizeAndDownsampleImageBuffer(
      imageBuffer,
      originalSize,
      detectedFormat,
    )
    result = createImageResponse(
      resized.buffer,
      resized.mediaType,
      originalSize,
      resized.dimensions,
    )
  } catch (e) {
    if (e instanceof ImageResizeError) throw e
    logError(e)
    result = createImageResponse(imageBuffer, detectedFormat, originalSize)
  }

  // Check if it fits in token budget
  const estimatedTokens = Math.ceil(result.file.base64.length * 0.125)
  if (estimatedTokens > maxTokens) {
    // Aggressive compression from the SAME buffer (no re-read)
    try {
      const compressed = await compressImageBufferWithTokenLimit(
        imageBuffer,
        maxTokens,
        detectedMediaType,
      )
      return {
        type: 'image',
        file: {
          base64: compressed.base64,
          type: compressed.mediaType,
          originalSize,
        },
      }
    } catch (e) {
      logError(e)
      // Fallback: heavily compressed version from the SAME buffer
      try {
        const sharpModule = await import('sharp');
        const sharp = (sharpModule as unknown as { default: typeof import('sharp') }).default || sharpModule;

        const fallbackBuffer = await sharp(imageBuffer)
          .resize(400, 400, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 20 })
          .toBuffer()

        return createImageResponse(fallbackBuffer, 'jpeg', originalSize)
      } catch (error) {
        logError(error)
        return createImageResponse(imageBuffer, detectedFormat, originalSize)
      }
    }
  }

  return result
}
export async function readFileBytes(fsPath: string, maxBytes?: number) {
    if (maxBytes === undefined) {
      return readFileAsync(fsPath)
    }
    const handle = await open(fsPath, 'r')
    try {
      const { size } = await stat(fsPath)
      const readSize = Math.min(size, maxBytes)
      const buffer = Buffer.allocUnsafe(readSize)
      let offset = 0
      while (offset < readSize) {
        const { bytesRead } = await handle.read(
          buffer,
          offset,
          readSize - offset,
          offset,
        )
        if (bytesRead === 0) break
        offset += bytesRead
      }
      return offset < readSize ? buffer.subarray(0, offset) : buffer
    } finally {
      await handle.close()
    }
  }
/*   如果不传入 maxBytes
直接调用 readFileAsync 完整读取整个文件并返回 Buffer
如果传入 maxBytes（限制最多读多少字节）
打开文件
获取文件大小
决定实际读取大小 = 文件大小 和 最大限制 中更小的那个
循环分批读取数据（防止一次读太多）
返回最终读到的字节缓冲区
无论成功失败，最后一定关闭文件（finally 保证） */
