
import { parseYaml } from './yaml'

// Markdown文件前置元数据(Frontmatter)解析器
/* ---
title: 示例文档
description: 这是一个描述
allowed-tools: ["bash", "python"]
type: project
---

这里是正文内容... */
/**
 * Pre-processes frontmatter text to quote values that contain special YAML characters.
 * This allows glob patterns like **\/*.{ts,tsx} to be parsed correctly.
 */
function quoteProblematicValues(frontmatterText: string): string {
  const lines = frontmatterText.split('\n')
  const result: string[] = []

  for (const line of lines) {
    // Match simple key: value lines (not indented, not list items, not block scalars)
    const match = line.match(/^([a-zA-Z_-]+):\s+(.+)$/)
    if (match) {
      const [, key, value] = match
      if (!key || !value) {
        result.push(line)
        continue
      }

      // Skip if already quoted
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        result.push(line)
        continue
      }

      // Quote if contains special YAML characters
      if (YAML_SPECIAL_CHARS.test(value)) {
        // Use double quotes and escape any existing double quotes
        const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        result.push(`${key}: "${escaped}"`)
        continue
      }
    }

    result.push(line)
  }

  return result.join('\n')
}
/**
 * Splits a comma-separated string and expands brace patterns.
 * Commas inside braces are not treated as separators.
 * Also accepts a YAML list (string array) for ergonomic frontmatter.
 * @param input - Comma-separated string, or array of strings, with optional brace patterns
 * @returns Array of expanded strings
 * @example
 * splitPathInFrontmatter("a, b") // returns ["a", "b"]
 * splitPathInFrontmatter("a, src/*.{ts,tsx}") // returns ["a", "src/*.ts", "src/*.tsx"]
 * splitPathInFrontmatter("{a,b}/{c,d}") // returns ["a/c", "a/d", "b/c", "b/d"]
 * splitPathInFrontmatter(["a", "src/*.{ts,tsx}"]) // returns ["a", "src/*.ts", "src/*.tsx"]
 */
export function splitPathInFrontmatter(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return input.flatMap(splitPathInFrontmatter)
  }
  if (typeof input !== 'string') {
    return []
  }
  // Split by comma while respecting braces
  const parts: string[] = []
  let current = ''
  let braceDepth = 0

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (char === '{') {
      braceDepth++
      current += char
    } else if (char === '}') {
      braceDepth--
      current += char
    } else if (char === ',' && braceDepth === 0) {
      // Split here - we're at a comma outside of braces
      const trimmed = current.trim()
      if (trimmed) {
        parts.push(trimmed)
      }
      current = ''
    } else {
      current += char
    }
  }

  // Add the last part
  const trimmed = current.trim()
  if (trimmed) {
    parts.push(trimmed)
  }

  // Expand brace patterns in each part
  return parts
    .filter(p => p.length > 0)
    .flatMap(pattern => expandBraces(pattern))
}
export type FrontmatterData = {
  // YAML can return null for keys with no value (e.g., "key:" with nothing after)
  'allowed-tools'?: string | string[] | null
  description?: string | null
  // Memory type: 'user', 'feedback', 'project', or 'reference'
  // Only applicable to memory files; narrowed via parseMemoryType() in src/memdir/memoryTypes.ts
  type?: string | null
  'argument-hint'?: string | null
  when_to_use?: string | null
  version?: string | null
  // Only applicable to slash commands -- a string similar to a boolean env var
  // to determine whether to make them visible to the SlashCommand tool.
  'hide-from-slash-command-tool'?: string | null
  // Model alias or name (e.g., 'haiku', 'sonnet', 'opus', or specific model names)
  // Use 'inherit' for commands to use the parent model
  model?: string | null
  // Comma-separated list of skill names to preload (only applicable to agents)
  skills?: string | null
  // Whether users can invoke this skill by typing /skill-name
  // 'true' = user can type /skill-name to invoke
  // 'false' = only model can invoke via Skill tool
  // Default depends on source: commands/ defaults to true, skills/ defaults to false
  'user-invocable'?: string | null
  // Effort level for agents (e.g., 'low', 'medium', 'high', 'xhigh', 'max', or an integer)
  // Controls the thinking effort used by the agent's model
  effort?: string | null
  // Execution context for skills: 'inline' (default) or 'fork' (run as sub-agent)
  // 'inline' = skill content expands into the current conversation
  // 'fork' = skill runs in a sub-agent with separate context and token budget
  context?: 'inline' | 'fork' | null
  // Agent type to use when forked (e.g., 'Bash', 'general-purpose')
  // Only applicable when context is 'fork'
  agent?: string | null
  // Glob patterns for file paths this skill applies to. Accepts either a
  // comma-separated string or a YAML list of strings.
  // When set, the skill is only activated when the model touches matching files
  // Uses the same format as CLAUDE.md paths frontmatter
  paths?: string | string[] | null
  // Shell to use for !`cmd` and ```! blocks in skill/command .md content.
  // 'bash' (default) or 'powershell'. File-scoped — applies to all !-blocks.
  // Never consults settings.defaultShell: skills are portable across platforms,
  // so the author picks the shell, not the reader. See docs/design/ps-shell-selection.md §5.3.
  shell?: string | null
  [key: string]: unknown
}
/**
 * Expands brace patterns in a glob string.
 * @example
 * expandBraces("src/*.{ts,tsx}") // returns ["src/*.ts", "src/*.tsx"]
 * expandBraces("{a,b}/{c,d}") // returns ["a/c", "a/d", "b/c", "b/d"]
 */
function expandBraces(pattern: string): string[] {
  // Find the first brace group
  const braceMatch = pattern.match(/^([^{]*)\{([^}]+)\}(.*)$/)

  if (!braceMatch) {
    // No braces found, return pattern as-is
    return [pattern]
  }

  const prefix = braceMatch[1] || ''
  const alternatives = braceMatch[2] || ''
  const suffix = braceMatch[3] || ''

  // Split alternatives by comma and expand each one
  const parts = alternatives.split(',').map(alt => alt.trim())

  // Recursively expand remaining braces in suffix
  const expanded: string[] = []
  for (const part of parts) {
    const combined = prefix + part + suffix
    // Recursively handle additional brace groups
    const furtherExpanded = expandBraces(combined)
    expanded.push(...furtherExpanded)
  }

  return expanded
}
export type ParsedMarkdown = {
  frontmatter: FrontmatterData
  content: string
}

// Characters that require quoting in YAML values (when unquoted)
// - { } are flow mapping indicators
// - * is anchor/alias indicator
// - [ ] are flow sequence indicators
// - ': ' (colon followed by space) is key indicator — causes 'Nested mappings
//   are not allowed in compact mappings' when it appears mid-value. Match the
//   pattern rather than bare ':' so '12:34' times and 'https://' URLs stay unquoted.
// - # is comment indicator
// - & is anchor indicator
// - ! is tag indicator
// - | > are block scalar indicators (only at start)
// - % is directive indicator (only at start)
// - @ ` are reserved
const YAML_SPECIAL_CHARS = /[{}[\]*&#!|>%@`]|: /
export const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)---\s*\n?/

/**
* 将 Markdown 内容解析以提取前文部分和正文部分 *
* @参数 markdown 原始的 Markdown 内容 *
*  @返回值 包含解析后的前文部分和正文部分（不含前文部分）的对象
 */
export function parseFrontmatter(
  markdown: string,
  sourcePath?: string,
): ParsedMarkdown {
  const match = markdown.match(FRONTMATTER_REGEX)

  if (!match) {
    // No frontmatter found
    return {
      frontmatter: {},
      content: markdown,
    }
  }

  const frontmatterText = match[1] || ''
  const content = markdown.slice(match[0].length)

  let frontmatter: FrontmatterData = {}
  try {
    const parsed = parseYaml(frontmatterText) as FrontmatterData | null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed
    }
  } catch {
    // YAML parsing failed - try again after quoting problematic values
    try {
      const quotedText = quoteProblematicValues(frontmatterText)//特殊字符处理 (quoteProblematicValues)
      const parsed = parseYaml(quotedText) as FrontmatterData | null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frontmatter = parsed
      }
    } catch (retryError) {
      // Still failed - log for debugging so users can diagnose broken frontmatter
      const location = sourcePath ? ` in ${sourcePath}` : ''
    }
  }

  return {
    frontmatter,
    content,
  }
}