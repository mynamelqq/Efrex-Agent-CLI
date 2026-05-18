import { dirname, sep } from 'path'
import { z } from 'zod/v4'
import type { ToolUseContext } from 'src/Tool.js'
import { writeTextContent } from 'src/utils/file'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { countLinesChanged } from 'src/utils/diff'
import { getCwd } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import {stat}from "fs/promises"
import { getPatchForDisplay } from 'src/utils/diff'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { ToolUseDiff } from 'src/utils/gitDiff'
import { mkdir } from 'fs'
import { getFileModificationTime } from 'src/utils/file'
import { isENOENT } from 'src/utils/errors.js'
import { fileHistoryEnabled } from 'src/utils/fileHistory'
import { FILE_UNEXPECTEDLY_MODIFIED_ERROR } from '../FileEditTool/constants'
import { fileHistoryTrackEdit } from 'src/utils/fileHistory'
// import { getFileModificationTime, writeTextContent } from 'src/utils/file.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logError } from 'src/utils/log.js'
import { readFileSyncWithMetadata } from 'src/utils/fileRead'
import { expandPath } from 'src/utils/path.js'
import { FILE_WRITE_TOOL_NAME } from './prompt'
import {
  getToolUseSummary,
  isResultTruncated,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI.js'
import { gitDiffSchema, hunkSchema } from '../FileEditTool/types.js'
import { ToolResultBlockParam } from 'src/package/message'
import { tr } from 'zod/v4/locales'
const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z
      .string()
      .describe(
        'The absolute path to the file to write (must be absolute, not relative)',
      ),
    content: z.string().describe('The content to write to the file'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    type: z
      .enum(['create', 'update'])
      .describe(
        'Whether a new file was created or an existing file was updated',
      ),
    filePath: z.string().describe('The path to the file that was written'),
    content: z.string().describe('The content that was written to the file'),
    structuredPatch: z
      .array(hunkSchema())
      .describe('Diff patch showing the changes'),
    originalFile: z
      .string()
      .nullable()
      .describe(
        'The original file content before the write (null for new files)',
      ),
    gitDiff: gitDiffSchema().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>
export type FileWriteToolInput = InputSchema
export const FileWriteTool = buildTool({
  name: FILE_WRITE_TOOL_NAME,
  searchHint: 'create or overwrite files',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Write a file to the local filesystem.'
  },
  userFacingName,
  getToolUseSummary,
    renderToolUseMessage,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
   async validateInput({ file_path, content }, toolUseContext: ToolUseContext) {
    const fullFilePath = expandPath(file_path)

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    // On Windows, fs.existsSync() on UNC paths triggers SMB authentication which could
    // leak credentials to malicious servers. Let the permission check handle UNC paths.
    if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
      return { result: true }
    }
    let fileMtimeMs: number
    try {
      const fileStat = await stat(fullFilePath)
      fileMtimeMs = fileStat.mtimeMs
    } catch (e) {
      if (isENOENT(e)) {
        return { result: true }
      }
      throw e
    }

    const readTimestamp = toolUseContext.readFileState.get(fullFilePath)

    // Reuse mtime from the stat above — avoids a redundant statSync via
    // getFileModificationTime.
    if (readTimestamp) {
      const lastWriteTime = Math.floor(fileMtimeMs)
      if (lastWriteTime > readTimestamp.timestamp) {
        return {
          result: false,
          message:
            'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
          errorCode: 3,
        }
      }
    }

    return { result: true }
  },
  renderToolResultMessage,
   async call(
    { file_path, content },
    { readFileState, updateFileHistoryState },
    assistantMessage,
  ) {
    const fullFilePath = expandPath(file_path)
    const dir = dirname(fullFilePath)

    // Discover skills from this file's path (fire-and-forget, non-blocking)
    const cwd = getCwd()

    // Ensure parent directory exists before the atomic read-modify-write section.
    // Must stay OUTSIDE the critical section below (a yield between the staleness
    // check and writeTextContent lets concurrent edits interleave), and BEFORE the
    // write (lazy-mkdir-on-ENOENT would fire a spurious tengu_atomic_write_error
    // inside writeFileSyncAndFlush_DEPRECATED before ENOENT propagates back).
    await mkdir(dir,()=>{})
    if (fileHistoryEnabled()) {//默认开启
      // Backup captures pre-edit content — safe to call before the staleness
      // check (idempotent v1 backup keyed on content hash; if staleness fails
      // later we just have an unused backup, not corrupt state).
      await fileHistoryTrackEdit(
        updateFileHistoryState,
        fullFilePath,
        assistantMessage.uuid,
      )
    }

// 加载当前状态，并确认自上次读取以来未发生任何更改。 // 请在此处及之后避免执行异步操作，以确保数据的一致性。
    let meta: ReturnType<typeof readFileSyncWithMetadata> | null
    try {
      meta = readFileSyncWithMetadata(fullFilePath)//读取文件的内容，编码，换行符风格
    } catch (e) {
      if (isENOENT(e)) {
        meta = null
      } else {
        throw e
      }
    }
    // staleness check（陈旧性检查），核心目的是：C必须先通过 FileReadTool 读取过文件，才能用 FileWriteTool/FileEditTool 写入。防止 Claude
  // 基于过时的认知覆盖外部已修改的内容。harness工程
    if (meta !== null) {//读取文件后会缓存文件的内容和修改时间双重校验文件是否被篡改：
// 先比修改时间再比对内容

      const lastWriteTime = getFileModificationTime(fullFilePath)//获取更改时间
      const lastRead = readFileState.get(fullFilePath)//
      // 前提：文件有缓存数据（meta !== null）
// 只有之前读过、缓存过文件信息，才需要做校验。
      if (!lastRead || lastWriteTime > lastRead.timestamp) {//没被读缓存过、上次写入时间大于上次阅读时间//说明文件被改过
        // Timestamp indicates modification, but on Windows timestamps can change
        // without content changes (cloud sync, antivirus, etc.). For full reads,
        // compare content as a fallback to avoid false positives.
        const isFullRead =//是不是全读
          lastRead &&
          lastRead.offset === undefined &&
          lastRead.limit === undefined
        // meta.content is CRLF-normalized — matches readFileState's normalized form.
        if (!isFullRead || meta.content !== lastRead.content) {//对比文件内容
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
      }
    }

    const enc = meta?.encoding ?? 'utf8'
    const oldContent = meta?.content ?? null

    // Write is a full content replacement — the model sent explicit line endings
    // in `content` and meant them. Do not rewrite them. Previously we preserved
    // the old file's line endings (or sampled the repo via ripgrep for new
    // files), which silently corrupted e.g. bash scripts with \r on Linux when
    // overwriting a CRLF file or when binaries in cwd poisoned the repo sample.
    writeTextContent(fullFilePath, content, enc, 'LF')//直接写入 核心流程



    // Update read timestamp, to invalidate stale writes
    readFileState.set(fullFilePath, {
      content,//cache更改
      timestamp: getFileModificationTime(fullFilePath),//更改修改时间
      offset: undefined,
      limit: undefined,
    })

    let gitDiff: ToolUseDiff | undefined


    if (oldContent) {//如果原来写入的文件有内容
      const patch = getPatchForDisplay({
        filePath: file_path,
        fileContents: oldContent,
        edits: [
          {
            old_string: oldContent,
            new_string: content,
            replace_all: false,
          },
        ],
      })

      const data = {
        type: 'update' as const,
        filePath: file_path,
        content,
        structuredPatch: patch,
        originalFile: oldContent,
        ...(gitDiff && { gitDiff }),
      }
      // Track lines added and removed for file updates, right before yielding result
      countLinesChanged(patch)

    

      return {
        data,
      }
    }

    const data = {//创建文件
      type: 'create' as const,
      filePath: file_path,
      content,
      structuredPatch: [],
      originalFile: null,
      ...(gitDiff && { gitDiff }),
    }

    // For creation of new files, count all lines as additions, right before yielding the result
    countLinesChanged([], content)

    return {
      data,
    }
  },
  mapToolResultToToolResultBlockParam({ filePath, type }, toolUseID) {
    switch (type) {
      case 'create':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `File created successfully at: ${filePath}`,
        } as ToolResultBlockParam
      case 'update':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `The file ${filePath} has been updated successfully.`,
        }as ToolResultBlockParam
    default:
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `The file ${filePath} has been updated successfully.`,
        }as ToolResultBlockParam
    }
  },
})