import { getGlobalConfig, saveGlobalConfig } from "src/utils/config"
import { AppState } from "./AppState"
import { permissionModeFromString, toExternalPermissionMode } from "src/utils/permissions/PermissionMode"
import { logError } from "src/utils/log"
import { toError } from "src/utils/errors"



// Inverse of the push below — restore on worker restart.
// export function externalMetadataToAppState(
//   metadata: SessionExternalMetadata,
// ): (prev: AppState) => AppState {
//   return prev => ({
//     ...prev,
//     ...(typeof metadata.permission_mode === 'string'
//       ? {
//           toolPermissionContext: {
//             ...prev.toolPermissionContext,
//             mode: permissionModeFromString(metadata.permission_mode),
//           },
//         }
//       : {}),
//     ...(typeof metadata.is_ultraplan_mode === 'boolean'
//       ? { isUltraplanMode: metadata.is_ultraplan_mode }
//       : {}),
//   })
// }
export function onChangeAppState({
  newState,
  oldState,
}: {
  newState: AppState
  oldState: AppState
}) {
  // toolPermissionContext.mode — single choke point for CCR/SDK mode sync.
  //
  // Prior to this block, mode changes were relayed to CCR by only 2 of 8+
  // mutation paths: a bespoke setAppState wrapper in print.ts (headless/SDK
  // mode only) and a manual notify in the set_permission_mode handler.
  // Every other path — Shift+Tab cycling, ExitPlanModePermissionRequest
  // dialog options, the /plan slash command, rewind, the REPL bridge's
  // onSetPermissionMode — mutated AppState without telling
  // CCR, leaving external_metadata.permission_mode stale and the web UI out
  // of sync with the CLI's actual mode.
  //
  // Hooking the diff here means ANY setAppState call that changes the mode
  // notifies CCR (via notifySessionMetadataChanged → ccrClient.reportMetadata)
  // and the SDK status stream (via notifyPermissionModeChanged → registered
  // in print.ts). The scattered callsites above need zero changes.
  const prevMode = oldState.toolPermissionContext.mode
  const newMode = newState.toolPermissionContext.mode
  if (prevMode !== newMode) {
    // CCR external_metadata must not receive internal-only mode names
    // (bubble, ungated auto). Externalize first — and skip
    // the CCR notify if the EXTERNAL mode didn't change (e.g.,
    // default→bubble→default is noise from CCR's POV since both
    // externalize to 'default'). The SDK channel (notifyPermissionModeChanged)
    // passes raw mode; its listener in print.ts applies its own filter.
    const prevExternal = toExternalPermissionMode(prevMode)
    const newExternal = toExternalPermissionMode(newMode)
    if (prevExternal !== newExternal) {
      // Ultraplan = first plan cycle only. The initial control_request
      // sets mode and isUltraplanMode atomically, so the flag's
      // transition gates it. null per RFC 7396 (removes the key).
      const isUltraplan =false
    //   notifySessionMetadataChanged({
    //     permission_mode: newExternal,
    //     is_ultraplan_mode: isUltraplan,
    //   })
    }
    // notifyPermissionModeChanged(newMode)
  }

  // mainLoopModel: session-scoped only (do NOT persist to userSettings).
  // Writing to settings.json would leak model changes into other running
  // sessions (anthropics/claude-code#37596). Each process keeps its own
  // model override in memory via setMainLoopModelOverride.
//   if (newState.mainLoopModel !== oldState.mainLoopModel) {
//     setMainLoopModelOverride(newState.mainLoopModel)
//   }



  // verbose
  if (
    newState.verbose !== oldState.verbose &&
    getGlobalConfig().verbose !== newState.verbose
  ) {
    const verbose = newState.verbose
    saveGlobalConfig(current => ({
      ...current,
      verbose,
    }))
  }


  // settings: clear auth-related caches when settings change
  // This ensures apiKeyHelper and AWS/GCP credential changes take effect immediately
  if (newState.settings !== oldState.settings) {
    try {
    //   clearApiKeyHelperCache()
    //   clearAwsCredentialsCache()
    //   clearGcpCredentialsCache()

      // Re-apply environment variables when settings.env changes
      // This is additive-only: new vars are added, existing may be overwritten, nothing is deleted
      if (newState.settings.env !== oldState.settings.env) {
        // applyConfigEnvironmentVariables()
      }
    } catch (error) {
      logError(toError(error))
    }
  }
}
