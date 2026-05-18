import { dirname, isAbsolute, sep } from 'path'
import type { ToolUseContext } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { stat } from 'fs/promises'
import { logForDebugging } from 'src/utils/debug.js'
import { countLinesChanged } from 'src/utils/diff.js'
import { writeTextContent } from 'src/utils/file.js'
import { fileHistoryTrackEdit } from 'src/utils/fileHistory.js'
import { fileHistoryEnabled } from 'src/utils/fileHistory.js'
import { mkdir } from 'fs'
import { findActualString,preserveQuoteStyle,getPatchForEdit} from './utils.js'
import { readFileSyncWithMetadata } from 'src/utils/fileRead.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isENOENT } from 'src/utils/errors.js'
import { getFileModificationTime } from 'src/utils/file.js'
import { LineEndingType } from 'src/utils/fileRead.js'
import { areFileEditsInputsEquivalent } from './utils.js'
import {
  FILE_NOT_FOUND_CWD_NOTE,
  findSimilarFile,
  suggestPathUnderCwd,
} from 'src/utils/file.js'
import { formatFileSize } from 'src/utils/format.js'
import { type ToolUseDiff } from 'src/utils/gitDiff.js'
import { logError } from 'src/utils/log.js'
import { expandPath } from 'src/utils/path.js'
import {
  type FileEditInput,
  type FileEditOutput,
  inputSchema,
  outputSchema,
} from './types.js'

import {
  FILE_EDIT_TOOL_NAME,
  FILE_UNEXPECTEDLY_MODIFIED_ERROR,
} from './constants.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI'
import { readFileBytes } from '../FileReadTool/FileReadTool.js'
const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024 // 1 GiB (stat bytes)
export const FileEditTool = buildTool({
  name: FILE_EDIT_TOOL_NAME,
  searchHint: 'modify file contents in place',
  maxResultSizeChars: 100_000,
  async description() {
    return 'A tool for editing files'
  },
  userFacingName,
  getToolUseSummary,
  get inputSchema() {
    return inputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  async validateInput(input: FileEditInput, toolUseContext: ToolUseContext) {
    const { file_path, old_string, new_string, replace_all = false } = input
    // Use expandPath for consistent path normalization (especially on Windows
    // where "/" vs "\" can cause readFileState lookup mismatches)
    const fullFilePath = expandPath(file_path)
    if (old_string === new_string) {
      return {
        result: false,
        behavior: 'ask',
        message:
          'No changes to make: old_string and new_string are exactly the same.',
        errorCode: 1,
      }
    }
    const appState = toolUseContext.getAppState()
    if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
      return { result: true }
    }
    // Prevent OOM on multi-GB files.
    try {
      const { size } = await stat(fullFilePath)
      if (size > MAX_EDIT_FILE_SIZE) {
        return {
          result: false,
          behavior: 'ask',
          message: `File is too large to edit (${formatFileSize(size)}). Maximum editable file size is ${formatFileSize(MAX_EDIT_FILE_SIZE)}.`,
          errorCode: 10,
        }
      }
    } catch (e) {
      if (!isENOENT(e)) {
        throw e
      }
    }
    // Read the file as bytes first so we can detect encoding from the buffer
    // instead of calling detectFileEncoding (which does its own sync readSync
    // and would fail with a wasted ENOENT when the file doesn't exist).
    let fileContent: string | null
    try {//确定字符
      const fileBuffer = await readFileBytes(fullFilePath)
      const encoding: BufferEncoding =
        fileBuffer.length >= 2 &&
        fileBuffer[0] === 0xff &&
        fileBuffer[1] === 0xfe
          ? 'utf16le'
          : 'utf8'
      fileContent = fileBuffer.toString(encoding).replaceAll('\r\n', '\n')
    } catch (e) {
      if (isENOENT(e)) {
        fileContent = null
      } else {
        throw e
      }
    }
    // File doesn't exist
    if (fileContent === null) {//文件不存在
      // Empty old_string on nonexistent file means new file creation — valid
      if (old_string === '') {
        return { result: true }
      }
      // Try to find a similar file with a different extension
      const similarFilename = findSimilarFile(fullFilePath)
      const cwdSuggestion = await suggestPathUnderCwd(fullFilePath)
      let message = `File does not exist. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`

      if (cwdSuggestion) {
        message += ` Did you mean ${cwdSuggestion}?`
      } else if (similarFilename) {
        message += ` Did you mean ${similarFilename}?`
      }

      return {
        result: false,
        behavior: 'ask',
        message,
        errorCode: 4,
      }
    }
    
    // File exists with empty old_string — only valid if file is empty
    if (old_string === '') {
      // Only reject if the file has content (for file creation attempt)
      if (fileContent.trim() !== '') {
        return {
          result: false,
          behavior: 'ask',
          message: 'Cannot create new file - file already exists.',
          errorCode: 3,
        }
      }

      // Empty file with empty old_string is valid - we're replacing empty with content
      return {
        result: true,
      }
    }
      const readTimestamp = toolUseContext.readFileState.get(fullFilePath)

    // Check if file exists and get its last modified time
    if (readTimestamp) {
      const lastWriteTime = getFileModificationTime(fullFilePath)
      if (lastWriteTime > readTimestamp.timestamp) {
        // Timestamp indicates modification, but on Windows timestamps can change
        // without content changes (cloud sync, antivirus, etc.). For full reads,
        // compare content as a fallback to avoid false positives.
        const isFullRead =
          readTimestamp.offset === undefined &&
          readTimestamp.limit === undefined
        if (isFullRead && fileContent === readTimestamp.content) {
          // Content unchanged, safe to proceed
        } else {
          return {
            result: false,
            behavior: 'ask',
            message:
              'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
            errorCode: 7,
          }
        }
      }
    }
    const file = fileContent
     // Use findActualString to handle quote normalization
    const actualOldString = findActualString(file, old_string)
    if (!actualOldString) {//找匹配old_string的列
      return {
        result: false,
        behavior: 'ask',
        message: `String to replace not found in file.\nString: ${old_string}`,
        meta: {
          isFilePathAbsolute: String(isAbsolute(file_path)),
        },
        errorCode: 8,
      }
    }
    const matches = file.split(actualOldString).length - 1
    // Check if we have multiple matches but replace_all is false
    if (matches > 1 && !replace_all) {//找到多个结果
      return {
        result: false,
        behavior: 'ask',
        message: `Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\nString: ${old_string}`,
        meta: {
          isFilePathAbsolute: String(isAbsolute(file_path)),
          actualOldString,
        },
        errorCode: 9,
      }
    }

    return { result: true, meta: { actualOldString } }

  },
  inputsEquivalent(input1, input2) {
    return areFileEditsInputsEquivalent(
      {
        file_path: input1.file_path,
        edits: [
          {
            old_string: input1.old_string,
            new_string: input1.new_string,
            replace_all: input1.replace_all ?? false,
          },
        ],
      },
      {
        file_path: input2.file_path,
        edits: [
          {
            old_string: input2.old_string,
            new_string: input2.new_string,
            replace_all: input2.replace_all ?? false,
          },
        ],
      },
    )
  },
  async call(
    input: FileEditInput,
    {
      readFileState,
      userModified,
      updateFileHistoryState,
    },
    parentMessage,
  ) {
    const { file_path, old_string, new_string, replace_all = false } = input

    // 1. Get current state
    const absoluteFilePath = expandPath(file_path)

    // Discover skills from this file's path (fire-and-forget, non-blocking)
    // Skip in simple mode - no skills available
    const cwd = getCwd()

    // Ensure parent directory exists before the atomic read-modify-write section.
    // These awaits must stay OUTSIDE the critical section below — a yield between
    // the staleness check and writeTextContent lets concurrent edits interleave.
    await mkdir(dirname(absoluteFilePath),()=>{})
    if (fileHistoryEnabled()) {
      // Backup captures pre-edit content — safe to call before the staleness
      // check (idempotent v1 backup keyed on content hash; if staleness fails
      // later we just have an unused backup, not corrupt state).
      await fileHistoryTrackEdit(
        updateFileHistoryState,
        absoluteFilePath,
        parentMessage.uuid,
      )
    }

    // 2. Load current state and confirm no changes since last read
    // Please avoid async operations between here and writing to disk to preserve atomicity
    const {
      content: originalFileContents,
      fileExists,
      encoding,
      lineEndings: endings,
    } = readFileForEdit(absoluteFilePath)

    if (fileExists) {
      const lastWriteTime = getFileModificationTime(absoluteFilePath)
      const lastRead = readFileState.get(absoluteFilePath)
      if (!lastRead || lastWriteTime > lastRead.timestamp) {
        // Timestamp indicates modification, but on Windows timestamps can change
        // without content changes (cloud sync, antivirus, etc.). For full reads,
        // compare content as a fallback to avoid false positives.
        const isFullRead =
          lastRead &&
          lastRead.offset === undefined &&
          lastRead.limit === undefined
        const contentUnchanged =
          isFullRead && originalFileContents === lastRead.content
        if (!contentUnchanged) {
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
      }
    }

    // 3. Use findActualString to handle quote normalization
    const actualOldString =
      findActualString(originalFileContents, old_string) || old_string

    // Preserve curly quotes in new_string when the file uses them
    const actualNewString = preserveQuoteStyle(
      old_string,
      actualOldString,
      new_string,
    )

    // 4. Generate patch
    const { patch, updatedFile } = getPatchForEdit({
      filePath: absoluteFilePath,
      fileContents: originalFileContents,
      oldString: actualOldString,
      newString: actualNewString,
      replaceAll: replace_all,
    })

    // 5. Write to disk
    writeTextContent(absoluteFilePath, updatedFile, encoding, endings)


    // // Notify VSCode about the file change for diff view
    // notifyVscodeFileUpdated(absoluteFilePath, originalFileContents, updatedFile)

    // 6. Update read timestamp, to invalidate stale writes
    readFileState.set(absoluteFilePath, {
      content: updatedFile,
      timestamp: getFileModificationTime(absoluteFilePath),
      offset: undefined,
      limit: undefined,
    })

    // 7. Log events
    countLinesChanged(patch)


    let gitDiff: ToolUseDiff | undefined

    // 8. Yield result
    const data = {
      filePath: file_path,
      oldString: actualOldString,
      newString: new_string,
      originalFile: originalFileContents,
      structuredPatch: patch,
      userModified: userModified ?? false,
      replaceAll: replace_all,
      ...(gitDiff && { gitDiff }),
    }
    return {
      data,
    }
  },
  mapToolResultToToolResultBlockParam(data: FileEditOutput, toolUseID) {
    const { filePath, userModified, replaceAll } = data
    const modifiedNote = userModified
      ? '.  The user modified your proposed changes before accepting them. '
      : ''

    if (replaceAll) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: `The file ${filePath} has been updated${modifiedNote}. All occurrences were successfully replaced.`,
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `The file ${filePath} has been updated successfully${modifiedNote}.`,
    }
  },


} satisfies ToolDef<ReturnType<typeof inputSchema>, FileEditOutput>)


function readFileForEdit(absoluteFilePath: string): {
  content: string
  fileExists: boolean
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  try {
    // eslint-disable-next-line custom-rules/no-sync-fs
    const meta = readFileSyncWithMetadata(absoluteFilePath)
    return {
      content: meta.content,
      fileExists: true,
      encoding: meta.encoding,
      lineEndings: meta.lineEndings,
    }
  } catch (e) {
    if (isENOENT(e)) {
      return {
        content: '',
        fileExists: false,
        encoding: 'utf8',
        lineEndings: 'LF',
      }
    }
    throw e
  }
}
