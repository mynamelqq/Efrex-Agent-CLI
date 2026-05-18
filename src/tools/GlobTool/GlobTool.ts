import { z } from 'zod/v4'
import { lazySchema } from '../../utils/lazySchema'
import { GLOB_TOOL_NAME } from './prompt'
import { DESCRIPTION } from './prompt'
import { expandPath, toRelativePath } from '../../utils/path.js'
import { buildTool } from '../../Tool'
import { ToolDef } from '../../Tool'
import {stat}from "fs/promises"
import { getCwd } from '../../utils/cwd'
import { glob } from '../../utils/glob.js'
import { suggestPathUnderCwd,FILE_NOT_FOUND_CWD_NOTE } from 'src/utils/file'
import {isENOENT}from "src/utils/errors"
import { renderToolResultMessage, renderToolUseMessage,renderToolUseErrorMessage } from './UI'
import { ValidationResult } from '../../Tool'
const inputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z.string().describe('The glob pattern to match files against'),
    path: z
      .string()
      .optional()
      .describe(
        'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
const outputSchema = lazySchema(() =>
  z.object({
    durationMs: z
      .number()
      .describe('Time taken to execute the search in milliseconds'),
    numFiles: z.number().describe('Total number of files found'),
    filenames: z
      .array(z.string())
      .describe('Array of file paths that match the pattern'),
    truncated: z
      .boolean()
      .describe('Whether results were truncated (limited to 100 files)'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>
export const GlobTool = buildTool({
    name: 'glob',
    searchHint: 'find files by name pattern or wildcard',
    maxResultSizeChars:100_000,
    async description() {
      return DESCRIPTION
    },
    userFacingName() {
      return 'Find'
    },

    get inputSchema(): InputSchema {
      return inputSchema()
    },
    get outputSchema():OutputSchema{
      return outputSchema()
    },
     async validateInput({ path }): Promise<ValidationResult> {
    // If path is provided, validate that it exists and is a directory
    if (path) {
      const absolutePath = expandPath(path)

      // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
      if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
        return { result: true }
      }

      let stats
      try {
        stats = await stat(absolutePath)
      } catch (e: unknown) {
        if (isENOENT(e)) {
          const cwdSuggestion = await suggestPathUnderCwd(absolutePath)
          let message = `Directory does not exist: ${path}. ${FILE_NOT_FOUND_CWD_NOTE} ${getCwd()}.`
          if (cwdSuggestion) {
            message += ` Did you mean ${cwdSuggestion}?`
          }
          return {
            result: false,
            message,
            errorCode: 1,
          }
        }
        throw e
      }

      if (!stats.isDirectory()) {
        return {
          result: false,
          message: `Path is not a directory: ${path}`,
          errorCode: 2,
        }
      }
    }

    return { result: true }
  },
    renderToolUseErrorMessage,
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    async call(input, context,assistantMessage,) {
      const start = Date.now()
      const searchPath = input.path ? expandPath(input.path) : getCwd()
      const limit = context.globLimits?.maxResults ?? 100
      const { files, truncated } = await glob(
        input.pattern,
        searchPath,
        { limit, offset: 0 },
        context.abortController.signal,
      )
      const filenames = files.map(toRelativePath)//节省token
      return {
        type: 'success',
        data: {
          filenames,
          durationMs: Date.now() - start,
          numFiles: filenames.length,
          truncated,
        } as Output,
      }
    },
    mapToolResultToToolResultBlockParam(output, toolUseID) {//内部执行结果转换为 要求的 tool_result block 
      if (output.filenames.length === 0) {
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: 'No files found',
        }
      }
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: [
          ...output.filenames,
          ...(output.truncated
            ? [
                '(Results are truncated. Consider using a more specific path or pattern.)',
              ]
            : []),
        ].join('\n'),
      }
    },
    renderToolResultMessage:renderToolResultMessage,
    renderToolUseMessage:renderToolUseMessage
  } satisfies ToolDef<InputSchema, Output>)
