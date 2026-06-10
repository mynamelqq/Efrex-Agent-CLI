
import { SHELL_KEYWORDS } from './bashParser.js'
import type { Node } from './parser'
import { PARSE_ABORTED, parseCommandRaw } from './parser'
export type Redirect = {//重定向
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string
  fd?: number
}

export type SimpleCommand = {
  /** argv[0] is the command name, rest are arguments with quotes already resolved */
  argv: string[]
  /** Leading VAR=val assignments */
  envVars: { name: string; value: string }[]
  /** Output/input redirects */
  redirects: Redirect[]
  /** Original source span for this command (for UI display) */
  text: string
}