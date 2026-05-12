
import { feature } from 'bun:bundle'
import memoize from 'lodash/memoize.js'
import { getIsGit } from './utils/git.js'
import { isEnvTruthy } from './utils/envUtils.js'
import { execFileNoThrow } from './utils/execFileNoThrow.js'
// import { getBranch, getDefaultBranch, getIsGit, gitExe } from './utils/git.js'
// import { shouldIncludeGitInstructions } from './utils/gitSettings.js'
import { logError } from './utils/log.js'
import { getLocalISODate } from './constants/common'

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getUserContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()

    // const claudeMd = shouldDisableClaudeMd
    //   ? null
    //   : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))
    // // Cache for the auto-mode classifier (yoloClassifier.ts reads this
    // // instead of importing claudemd.ts directly, which would create a
    // // cycle through permissions/filesystem → permissions → yoloClassifier).


    return {
    //   ...(claudeMd && { claudeMd }),
      currentDate: `Today's date is ${getLocalISODate()}.`,
    }
  },
)

// /**
//  * This context is prepended to each conversation, and cached for the duration of the conversation.
//  */
// export const getSystemContext = memoize(
//   async (): Promise<{
//     [k: string]: string
//   }> => {
//     const startTime = Date.now()

//     // Skip git status in CCR (unnecessary overhead on resume) or when git instructions are disabled
//     const gitStatus =
//       isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
//       !shouldIncludeGitInstructions()
//         ? null
//         : await getGitStatus()

//     return {
//       ...(gitStatus && { gitStatus }),
//     }
//   },
// )
// export const getGitStatus = memoize(async (): Promise<string | null> => {
//   if (process.env.NODE_ENV === 'test') {
//     return null
//   }
//   const startTime = Date.now()
//   const isGitStart = Date.now()
//   const isGit = await getIsGit()//该目录有没有git
//   if (!isGit) {
//     return null
//   }

//   try {
//     const gitCmdsStart = Date.now()//, mainBranch, status, log, userName
//     const [branch] = await Promise.all([
//       // getBranch(),
//       getDefaultBranch(),
//       // execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {
//       //   preserveOutputOnError: false,
//       // }).then(({ stdout }) => stdout.trim()),
//       // execFileNoThrow(
//       //   gitExe(),
//       //   ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
//       //   {
//       //     preserveOutputOnError: false,
//       //   },
//       // ).then(({ stdout }) => stdout.trim()),
//       // execFileNoThrow(gitExe(), ['config', 'user.name'], {
//       //   preserveOutputOnError: false,
//       // }).then(({ stdout }) => stdout.trim()),
//     ])


//     // // Check if status exceeds character limit
//     // const truncatedStatus =
//     //   status.length > MAX_STATUS_CHARS
//     //     ? status.substring(0, MAX_STATUS_CHARS) +
//     //       '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)'
//     //     : status


//     return [
//       `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
//       `Current branch: ${branch}`,
//       `Main branch (you will usually use this for PRs): ${mainBranch}`,
//       ...(userName ? [`Git user: ${userName}`] : []),
//       `Status:\n${truncatedStatus || '(clean)'}`,
//       `Recent commits:\n${log}`,
//     ].join('\n\n')
//   } catch (error) {
//     logError(error)
//     return null
//   }
// })
