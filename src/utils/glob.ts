import { isAbsolute, join } from 'path'
import { ripGrep } from './ripgrep.js'

function extractGlobBaseDirectory(pattern: string): {
  baseDir: string
  relativePattern: string
} {
  const match = pattern.match(/[*?[{}]/)
  if (!match || match.index === undefined) {
    return { baseDir: '', relativePattern: pattern }
  }

  const prefix = pattern.slice(0, match.index)
  const lastSep = Math.max(
    prefix.lastIndexOf('/'),
    prefix.lastIndexOf('\\'),
  )

  if (lastSep === -1) {
    return { baseDir: '', relativePattern: pattern }
  }

  return {
    baseDir: prefix.slice(0, lastSep),
    relativePattern: pattern.slice(lastSep + 1),
  }
}

export async function glob(
  filePattern: string,
  cwd: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
): Promise<{ files: string[]; truncated: boolean }> {
  let searchDir = cwd
  let searchPattern = filePattern

  if (isAbsolute(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)//获得相对路径
    if (baseDir) {
      searchDir = baseDir
      searchPattern = relativePattern
    }
  }

  const args = ['--files', '--glob', searchPattern, '--sort=modified']
  const allPaths = await ripGrep(args, searchDir, abortSignal)
// ripgrep returns relative paths, convert to absolute
  const absolutePaths = allPaths.map(p =>
    isAbsolute(p) ? p : join(searchDir, p),
  )

  const truncated = absolutePaths.length > offset + limit//裁剪
  const files = absolutePaths.slice(offset, offset + limit)

  return { files, truncated }
}
