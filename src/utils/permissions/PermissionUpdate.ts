import { posix } from 'path'
import type { ToolPermissionContext } from '../../Tool.js'
import { logForDebugging } from '../debug.js'
import { EditableSettingSource } from '../settings/constants.js'
import {
  getSettingsForSource,
} from '../settings/settings.js'
import { updateSettingsForSource } from '../settings/settings.js'
import { addPermissionRulesToSettings } from './permissionsloader.js'

import { PermissionUpdate,PermissionUpdateDestination } from 'src/types/permissions.js'
import { permissionRuleValueToString,permissionRuleValueFromString } from './permissionRuleParser.js'

export function supportsPersistence(
  destination: PermissionUpdateDestination,
): destination is EditableSettingSource {
  return (
    destination === 'localSettings' ||
    destination === 'userSettings' ||
    destination === 'projectSettings'
  )
}

/**
 * Applies multiple permission updates to the context and returns the updated context
 * @param context The current permission context
 * @param updates The permission updates to apply
 * @returns The updated permission context
 */
export function applyPermissionUpdates(
  context: ToolPermissionContext,
  updates: PermissionUpdate[],
): ToolPermissionContext {
  let updatedContext = context
  for (const update of updates) {
    updatedContext = applyPermissionUpdate(updatedContext, update)
  }

  return updatedContext
}

/**
 * Persists multiple permission updates to the appropriate settings sources
 * Only persists updates with persistable sources
 * @param updates The permission updates to persist
 */
export function persistPermissionUpdates(updates: PermissionUpdate[]): void {
  for (const update of updates) {
    persistPermissionUpdate(update)
  }
}
/**
 * Persists a permission update to the appropriate settings source
 * @param update The permission update to persist
 */
export function persistPermissionUpdate(update: PermissionUpdate): void {
  if (!supportsPersistence(update.destination)) return

  logForDebugging(
    `Persisting permission update: ${update.type} to source '${update.destination}'`,
  )

  switch (update.type) {
    case 'addRules': {
      logForDebugging(
        `Persisting ${update.rules.length} ${update.behavior} rule(s) to ${update.destination}`,
      )
      addPermissionRulesToSettings(
        {
          ruleValues: update.rules,
          ruleBehavior: update.behavior,
        },
        update.destination,
      )
      break
    }

    case 'addDirectories': {
      logForDebugging(
        `Persisting ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} to ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingDirs =
        existingSettings?.permissions?.additionalDirectories || []

      // Add new directories, avoiding duplicates
      const dirsToAdd = update.directories.filter(
        dir => !existingDirs.includes(dir),
      )

      if (dirsToAdd.length > 0) {
        const updatedDirs = [...existingDirs, ...dirsToAdd]
        updateSettingsForSource(update.destination, {
          permissions: {
            additionalDirectories: updatedDirs,
          },
        })
      }
      break
    }

    case 'removeRules': {
      // Handle rule removal
      logForDebugging(
        `Removing ${update.rules.length} ${update.behavior} rule(s) from ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingPermissions = existingSettings?.permissions || {}
      const existingRules = existingPermissions[update.behavior] || []

      // Convert rules to normalized strings for comparison
      // Normalize via parse→serialize roundtrip so "Bash(*)" and "Bash" match
      const rulesToRemove = new Set(
        update.rules.map(permissionRuleValueToString),
      )
      const filteredRules = existingRules.filter(rule => {
        const normalized = permissionRuleValueToString(
          permissionRuleValueFromString(rule),
        )
        return !rulesToRemove.has(normalized)
      })

      updateSettingsForSource(update.destination, {
        permissions: {
          [update.behavior]: filteredRules,
        },
      })
      break
    }

    case 'removeDirectories': {
      logForDebugging(
        `Removing ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} from ${update.destination}`,
      )
      const existingSettings = getSettingsForSource(update.destination)
      const existingDirs =
        existingSettings?.permissions?.additionalDirectories || []

      // Remove specified directories
      const dirsToRemove = new Set(update.directories)
      const filteredDirs = existingDirs.filter(dir => !dirsToRemove.has(dir))

      updateSettingsForSource(update.destination, {
        permissions: {
          additionalDirectories: filteredDirs,
        },
      })
      break
    }

    case 'setMode': {
      logForDebugging(
        `Persisting mode '${update.mode}' to ${update.destination}`,
      )
      updateSettingsForSource(update.destination, {
        permissions: {
          defaultMode: update.mode,
        },
      })
      break
    }

    // case 'replaceRules': {
    //   logForDebugging(
    //     `Replacing all ${update.behavior} rules in ${update.destination} with ${update.rules.length} rule(s)`,
    //   )
    //   const ruleStrings = update.rules.map(permissionRuleValueToString)
    //   updateSettingsForSource(update.destination, {
    //     permissions: {
    //       [update.behavior]: ruleStrings,
    //     },
    //   })
    //   break
    // }
  }
}
