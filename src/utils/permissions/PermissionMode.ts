
import z from 'zod/v4'
// Types extracted to src/types/permissions.ts to break import cycles
import {
  EXTERNAL_PERMISSION_MODES,
  type ExternalPermissionMode,
  PERMISSION_MODES,
  type PermissionMode,
} from '../../types/permissions.js'
import type { Color } from 'packages/@ant/ink/src/index.js'
import { lazySchema } from '../lazySchema.js'

// Re-export for backwards compatibility
export {
  EXTERNAL_PERMISSION_MODES,
  PERMISSION_MODES,
  type ExternalPermissionMode,
  type PermissionMode,
}

export const permissionModeSchema = lazySchema(() => z.enum(PERMISSION_MODES))
export const externalPermissionModeSchema = lazySchema(() =>
  z.enum(EXTERNAL_PERMISSION_MODES),
)

type PermissionModeConfig = {
  title: string
  shortTitle: string
  symbol: string
  color: Color
  external: ExternalPermissionMode
}
export const PAUSE_ICON = '\u23f8' // ⏸
const PERMISSION_MODE_CONFIG: Partial<
  Record<PermissionMode, PermissionModeConfig>
> = {
  default: {
    title: 'Default',
    shortTitle: 'Default',
    symbol: '',
    color: 'ansi:cyanBright',
    external: 'default',
  },
  acceptEdits: {
    title: 'Accept edits',
    shortTitle: 'Accept',
    symbol: '⏵⏵',
    color: 'ansi:magenta',
    external: 'acceptEdits',
  },
  plan: {
    title: 'Plan Mode',
    shortTitle: 'Plan',
    symbol: PAUSE_ICON,
    color: 'ansi:yellow',
    external: 'plan',
  },
  bypassPermissions: {
    title: 'Bypass',
    shortTitle: 'Bypass',
    symbol: '⏵⏵',
    color: 'ansi:red',
    external: 'bypassPermissions',
  },

  // dontAsk: {
  //   title: "Don't Ask",
  //   shortTitle: 'DontAsk',
  //   symbol: '⏵⏵',
  //   color: 'error',
  //   external: 'dontAsk',
  // },
  // auto: {
  //   title: 'Auto',
  //   shortTitle: 'Auto',
  //   symbol: '⏵⏵',
  //   color: 'warning' as ModeColorKey,
  //   external: 'default' as ExternalPermissionMode,
  // },
}

export function getPermissionModeConfig(
  mode: PermissionMode,
): PermissionModeConfig {
  return PERMISSION_MODE_CONFIG[mode] ?? PERMISSION_MODE_CONFIG.default!
}

/**
 * Type guard to check if a PermissionMode is an ExternalPermissionMode.
 * auto is ant-only and excluded from external modes.
 */
export function isExternalPermissionMode(
  mode: PermissionMode,
): mode is ExternalPermissionMode {
  // External users can't have auto, so always true for them
  if (process.env.USER_TYPE !== 'ant') {
    return true
  }
  return mode !== 'auto' && mode !== 'bubble'
}

function getModeConfig(mode: PermissionMode): PermissionModeConfig {
  return getPermissionModeConfig(mode)
}

export function toExternalPermissionMode(
  mode: PermissionMode,
): ExternalPermissionMode {
  return getModeConfig(mode).external
}

export function permissionModeFromString(str: string): PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(str)
    ? (str as PermissionMode)
    : 'default'
}

export function permissionModeTitle(mode: PermissionMode): string {
  return getModeConfig(mode).title
}

export function isDefaultMode(mode: PermissionMode | undefined): boolean {
  return mode === 'default' || mode === undefined
}

export function permissionModeShortTitle(mode: PermissionMode): string {
  return getModeConfig(mode).shortTitle
}

export function permissionModeSymbol(mode: PermissionMode): string {
  return getModeConfig(mode).symbol
}

export function getModeColor(mode: PermissionMode): Color {
  return getModeConfig(mode).color
}
