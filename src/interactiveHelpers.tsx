import { Root, TextProps } from './ink.js';
import { appendFileSync } from 'fs';
import React from 'react';
import { PermissionMode } from './types/permissions.js';
import { Command } from './types/command.js';
import { isEnvTruthy } from './utils/envUtils.js';
import { getGlobalConfig, saveGlobalConfig } from './utils/config.js';
import { onChangeAppState } from './state/onChangeAppState.js';
import { isSynchronizedOutputSupported } from './ink/terminal.js';
import { RenderOptions } from 'packages/@ant/ink/src/index.js';
import { getBaseRenderOptions } from './utils/renderOptions.js';
export function completeOnboarding(): void {
  saveGlobalConfig(current => ({
    ...current,
    hasCompletedOnboarding: true,
    lastOnboardingVersion: typeof MACRO !== 'undefined' ? MACRO.VERSION : current.lastOnboardingVersion,
  }));
}

export function showSetupDialog<T = void>(
  root: Root,
  renderer: (done: (result: T) => void) => React.ReactNode,
  _options?: unknown,
): Promise<T> {
  return new Promise<T>(resolve => {
    const done = (result: T): void => {
      resolve(result);
    };
    root.render(renderer(done));
  });
}


export async function showSetupScreens(
  root: Root,
  // permissionMode: PermissionMode,
  // allowDangerouslySkipPermissions: boolean,
  // commands?: Command[],
  // claudeInChrome?: boolean,
//   devChannels?: ChannelEntry[],
): Promise<boolean> {
  const config = getGlobalConfig();
  let onboardingShown = false;
  if (
    !config.theme ||
    !config.hasCompletedOnboarding // always show onboarding at least once
  ) {
    onboardingShown = true;
    const { Onboarding } = await import('./components/onBoarding.js');
    await showSetupDialog(
      root,
      done => (
        <Onboarding
          onDone={() => {
            try {
              completeOnboarding();
            } finally {
              done();
            }
          }}
        />
      ),
      { onChangeAppState }
    );
  }

//   // Always show the trust dialog in interactive sessions, regardless of permission mode.
//   // The trust dialog is the workspace trust boundary — it warns about untrusted repos
//   // and checks CLAUDE.md external includes. bypassPermissions mode
//   // only affects tool execution permissions, not workspace trust.
//   // Note: non-interactive sessions (CI/CD with -p) never reach showSetupScreens at all.
//   // Skip permission checks in claubbit
//   if (!isEnvTruthy(process.env.CLAUBBIT)) {
//     // Fast-path: skip TrustDialog import+render when CWD is already trusted.
//     // If it returns true, the TrustDialog would auto-resolve regardless of
//     // security features, so we can skip the dynamic import and render cycle.
//     if (!checkHasTrustDialogAccepted()) {
//       const { TrustDialog } = await import('./components/TrustDialog/TrustDialog.js');
//       await showSetupDialog(root, done => <TrustDialog commands={commands} onDone={done} />);
//     }

//     // Signal that trust has been verified for this session.
//     // GrowthBook checks this to decide whether to include auth headers.
//     setSessionTrustAccepted(true);

//     // Reset and reinitialize GrowthBook after trust is established.
//     // Defense for login/logout: clears any prior client so the next init
//     // picks up fresh auth headers.
//     resetGrowthBook();
//     void initializeGrowthBook();

//     // Now that trust is established, prefetch system context if it wasn't already
//     void getSystemContext();

//     // If settings are valid, check for any mcp.json servers that need approval
//     const { errors: allErrors } = getSettingsWithAllErrors();
//     if (allErrors.length === 0) {
//       await handleMcpjsonServerApprovals(root);
//     }

//     // Check for claude.md includes that need approval
//     if (await shouldShowClaudeMdExternalIncludesWarning()) {
//       const externalIncludes = getExternalClaudeMdIncludes(await getMemoryFiles(true));
//       const { ClaudeMdExternalIncludesDialog } = await import('./components/ClaudeMdExternalIncludesDialog.js');
//       await showSetupDialog(root, done => (
//         <ClaudeMdExternalIncludesDialog onDone={done} isStandaloneDialog externalIncludes={externalIncludes} />
//       ));
//     }
//   }

  // Track current repo path for teleport directory switching (fire-and-forget)
  // This must happen AFTER trust to prevent untrusted directories from poisoning the mapping
//   void updateGithubRepoPathMapping();


  // Apply full environment variables after trust dialog is accepted OR in bypass mode
  // In bypass mode (CI/CD, automation), we trust the environment so apply all variables
  // In normal mode, this happens after the trust dialog is accepted
  // This includes potentially dangerous environment variables from untrusted sources
//   applyConfigEnvironmentVariables();

  // Initialize telemetry after env vars are applied so OTEL endpoint env vars and
  // otelHeadersHelper (which requires trust to execute) are available.
  // Defer to next tick so the OTel dynamic import resolves after first render
  // instead of during the pre-render microtask queue.


//   if (await isQualifiedForGrove()) {
//     const { GroveDialog } = await import('src/components/grove/Grove.js');
//     const decision = await showSetupDialog<string>(root, done => (
//       <GroveDialog
//         showIfAlreadyViewed={false}
//         location={onboardingShown ? 'onboarding' : 'policy_update_modal'}
//         onDone={done}
//       />
//     ));
//     if (decision === 'escape') {
//       logEvent('tengu_grove_policy_exited', {});
//       gracefulShutdownSync(0);
//       return false;
//     }
//   }

  // Check for custom API key
  // On homespace, ANTHROPIC_API_KEY is preserved in process.env for child
  // processes but ignored by Claude Code itself (see auth.ts).
//   if (process.env.ANTHROPIC_API_KEY && !isRunningOnHomespace()) {
//     const customApiKeyTruncated = normalizeApiKeyForConfig(process.env.ANTHROPIC_API_KEY);
//     const keyStatus = getCustomApiKeyStatus(customApiKeyTruncated);
//     if (keyStatus === 'new') {
//       const { ApproveApiKey } = await import('./components/ApproveApiKey.js');
//       await showSetupDialog<boolean>(
//         root,
//         done => <ApproveApiKey customApiKeyTruncated={customApiKeyTruncated} onDone={done} />,
//         { onChangeAppState },
//       );
//     }
//   }

//   if (
//     (permissionMode === 'bypassPermissions' || allowDangerouslySkipPermissions) &&
//     !hasSkipDangerousModePermissionPrompt()
//   ) {
//     const { BypassPermissionsModeDialog } = await import('./components/BypassPermissionsModeDialog.js');
//     await showSetupDialog(root, done => <BypassPermissionsModeDialog onAccept={done} />);
//   }

  // --dangerously-load-development-channels confirmation. On accept, append
  // dev channels to any --channels list already set in main.tsx. Org policy
  // is NOT bypassed — gateChannelServer() still runs; this flag only exists
  // to sidestep the --channels approved-server allowlist.
//   if (devChannels && devChannels.length > 0) {
//     const { DevChannelsDialog } = await import('./components/DevChannelsDialog.js');
//     await showSetupDialog(root, done => (
//       <DevChannelsDialog
//         channels={devChannels}
//         onAccept={() => {
//           // Mark dev entries per-entry so the allowlist bypass doesn't leak
//           // to --channels entries when both flags are passed.
//           setAllowedChannels([...getAllowedChannels(), ...devChannels.map(c => ({ ...c, dev: true }))]);
//           setHasDevChannels(true);
//           void done();
//         }}
//       />
//     ));
//   }

  // Show Chrome onboarding for first-time Claude in Chrome users
//   if (claudeInChrome && !getGlobalConfig().hasCompletedClaudeInChromeOnboarding) {
//     const { ClaudeInChromeOnboarding } = await import('./components/ClaudeInChromeOnboarding.js');
//     await showSetupDialog(root, done => <ClaudeInChromeOnboarding onDone={done} />);
//   }

  return onboardingShown;
}

export function getRenderContext(exitOnCtrlC: boolean): {
  renderOptions: RenderOptions;
} {
  let lastFlickerTime = 0;
  const baseOptions = getBaseRenderOptions(exitOnCtrlC);


  // Bench mode: when set, append per-frame phase timings as JSONL for
  // offline analysis by bench/repl-scroll.ts. Captures the full TUI
  // render pipeline (yoga → screen buffer → diff → optimize → stdout)
  // so perf work on any phase can be validated against real user flows.
  const frameTimingLogPath = process.env.CLAUDE_CODE_FRAME_TIMING_LOG;
  return {
    renderOptions: {
      ...baseOptions,
      onFrame: event => {
       
        if (frameTimingLogPath && event.phases) {
          // Bench-only env-var-gated path: sync write so no frames dropped
          // on abrupt exit. ~100 bytes at ≤60fps is negligible. rss/cpu are
          // single syscalls; cpu is cumulative — bench side computes delta.
          const line =
            // eslint-disable-next-line custom-rules/no-direct-json-operations -- tiny object, hot bench path
            JSON.stringify({
              total: event.durationMs,
              ...event.phases,
              rss: process.memoryUsage.rss(),
              cpu: process.cpuUsage(),
            }) + '\n';
          // eslint-disable-next-line custom-rules/no-sync-fs -- bench-only, sync so no frames dropped on exit
          appendFileSync(frameTimingLogPath, line);
        }
        // Skip flicker reporting for terminals with synchronized output —
        // DEC 2026 buffers between BSU/ESU so clear+redraw is atomic.
        if (isSynchronizedOutputSupported()) {
          return;
        }

      },
    },
  };
}
/**
 * Render an error message through Ink, then unmount and exit.
 * Use this for fatal errors after the Ink root has been created —
 * console.error is swallowed by Ink's patchConsole, so we render
 * through the React tree instead.
 */
export async function exitWithError(root: Root, message: string, beforeExit?: () => Promise<void>): Promise<never> {
  return exitWithMessage(root, message, { color: 'ansi:red', beforeExit });
}
/**
 * Render a message through Ink, then unmount and exit.
 * Use this for messages after the Ink root has been created —
 * console output is swallowed by Ink's patchConsole, so we render
 * through the React tree instead.
 */
export async function exitWithMessage(
  root: Root,
  message: string,
  options?: {
    color?: TextProps['color'];
    exitCode?: number;
    beforeExit?: () => Promise<void>;
  },
): Promise<never> {
  const { Text } = await import('@anthropic/ink');
  const color = options?.color;
  const exitCode = options?.exitCode ?? 1;
  root.render(color ? <Text color={color}>{message}</Text> : <Text>{message}</Text>);
  root.unmount();
  await options?.beforeExit?.();
  // eslint-disable-next-line custom-rules/no-process-exit -- exit after Ink unmount
  process.exit(exitCode);
}

