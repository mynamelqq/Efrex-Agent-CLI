// import { readdir } from 'fs/promises'
// import { basename, join } from 'path'
// import { readFileInRange } from '../utils/readFileInRange'
// export type MemoryHeader = {
//   filename: string
//   filePath: string
//   mtimeMs: number
//   description: string | null
//   type: MemoryType | undefined
// }
// export async function scanMemoryFiles(
//   memoryDir: string,
//   signal: AbortSignal,
// ): Promise<MemoryHeader[]> {
//   try {
//     const entries = await readdir(memoryDir, { recursive: true })
//     const mdFiles = entries.filter(
//       f => f.endsWith('.md') && basename(f) !== 'MEMORY.md',
//     )

//     const headerResults = await Promise.allSettled(
//       mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
//         const filePath = join(memoryDir, relativePath)
//         const { content, mtimeMs } = await readFileInRange(
//           filePath,
//           0,
//           FRONTMATTER_MAX_LINES,
//           undefined,
//           signal,
//         )
//         const { frontmatter } = parseFrontmatter(content, filePath)
//         return {
//           filename: relativePath,
//           filePath,
//           mtimeMs,
//           description: frontmatter.description || null,
//           type: parseMemoryType(frontmatter.type),
//         }
//       }),
//     )

//     return headerResults
//       .filter(
//         (r): r is PromiseFulfilledResult<MemoryHeader> =>
//           r.status === 'fulfilled',
//       )
//       .map(r => r.value)
//       .sort((a, b) => b.mtimeMs - a.mtimeMs)
//       .slice(0, MAX_MEMORY_FILES)
//   } catch {
//     return []
//   }
// }