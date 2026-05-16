import { dirname, isAbsolute, sep } from 'path'
import type { ToolUseContext } from 'src/Tool.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { getCwd } from 'src/utils/cwd.js'
import { logForDebugging } from 'src/utils/debug.js'
import { countLinesChanged } from 'src/utils/diff.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isENOENT } from 'src/utils/errors.js'
import {
  FILE_NOT_FOUND_CWD_NOTE,
  findSimilarFile,
  suggestPathUnderCwd,
} from 'src/utils/file.js'
import { formatFileSize } from 'src/utils/format.js'
import { fetchSingleFileGitDiff, type ToolUseDiff } from 'src/utils/gitDiff.js'
import { logError } from 'src/utils/log.js'
import { expandPath } from 'src/utils/path.js'
import {
  type FileEditInput,
  type FileEditOutput,
  inputSchema,
  outputSchema,
} from './types.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI.js'





const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024 // 1 GiB (stat bytes)
