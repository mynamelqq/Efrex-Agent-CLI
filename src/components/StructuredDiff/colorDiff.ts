import * as colorDiffNapi from 'color-diff-napi'
import type { ColorFile, SyntaxTheme } from 'color-diff-napi'
import { isEnvDefinedFalsy } from '../../utils/envUtils.js'

export type ColorModuleUnavailableReason = 'env'

/**
 * Returns a static reason why the color-diff module is unavailable, or null if available.
 * 'env' = disabled via CLAUDE_CODE_SYNTAX_HIGHLIGHT
 *
 * The TS port of color-diff works in all build modes, so the only way to
 * disable it is via the env var.
 */
export function getColorModuleUnavailableReason(): ColorModuleUnavailableReason | null {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_SYNTAX_HIGHLIGHT)) {
    return 'env'
  }
  return null
}

function getNativeColorDiff(): typeof colorDiffNapi.ColorDiff | null {
  return (colorDiffNapi as typeof colorDiffNapi & {
    ColorDiff?: typeof colorDiffNapi.ColorDiff
  }).ColorDiff ?? null
}

function getNativeColorFile(): typeof ColorFile | null {
  return (colorDiffNapi as typeof colorDiffNapi & {
    ColorFile?: typeof ColorFile
  }).ColorFile ?? null
}

function getNativeGetSyntaxTheme():
  | ((themeName: string) => SyntaxTheme | null)
  | null {
  return (colorDiffNapi as typeof colorDiffNapi & {
    getSyntaxTheme?: (themeName: string) => SyntaxTheme | null
  }).getSyntaxTheme ?? null
}

export function expectColorDiff(): typeof colorDiffNapi.ColorDiff | null {
  return getColorModuleUnavailableReason() === null ? getNativeColorDiff() : null
}

export function expectColorFile(): typeof ColorFile | null {
  return getColorModuleUnavailableReason() === null ? getNativeColorFile() : null
}

export function getSyntaxTheme(themeName: string): SyntaxTheme | null {
  return getColorModuleUnavailableReason() === null
    ? getNativeGetSyntaxTheme()?.(themeName) ?? null
    : null
}
