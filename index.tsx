#!/usr/bin/env node

/**
 * ChatUI-Cli
 * a terminal agent developed by YaQi Li(Efrewew)
 *
 * @author Yaqi Li <github.com/mynamelqq>
 */
import { AppState, getDefaultAppState } from './src/state/AppState.js';
import {
	exitWithError,
	getRenderContext,
  showSetupScreens
} from './src/interactiveHelpers.js';
import { getCwd } from './src/utils/cwd.js';
import { loadConversationForResume } from 'src/utils/conservationRecovery.js';
import React from 'react';
import { processResumedConversation } from 'src/utils/sessionRestore.js';
import { attachErrorLogSink,  } from './src/utils/log.js';
import path from 'node:path';
import Launcher from './src/launcher.js';
import { init } from 'src/entrypoints/init.js';
import { homedir } from 'node:os';
import { createRoot, Root } from './src/ink.js';
import { existsSync, mkdirSync } from 'node:fs';
import { getSettingsWithErrors } from 'src/utils/settings/settings.js';
import { enableConfigs } from './src/utils/config.js';
import { InvalidSettingsDialog } from './src/components/InvalidSettingsDialog.js';
import { getCommands } from 'src/commands.js';
import type { Props as LauncherProps } from './src/QueryApp.js';
import { gracefulShutdown } from 'src/utils/gracefulShutdown.js';

function gracefulShutdownSync(exitCode: number): never {
	process.exit(exitCode);
}

function StartupGate({
	settingsErrors,
	launcherProps,
}: {
	settingsErrors: ReturnType<typeof getSettingsWithErrors>['errors'];
	launcherProps: React.ComponentProps<typeof Launcher>;
}): React.ReactNode {
	const [shouldContinue, setShouldContinue] = React.useState(
		settingsErrors.length === 0,
	);

	if (!shouldContinue) {
		return (
			<InvalidSettingsDialog
				settingsErrors={settingsErrors}
				onExit={() => gracefulShutdownSync(1)}
				onContinue={() => setShouldContinue(true)}
			/>
		);
	}

	return <Launcher {...launcherProps} />;
}

(async () => {
	process.title='efrex'
    // Ink root is only needed for interactive sessions — patchConsole in the
	// Ink constructor would swallow console output in headless mode.
	let root!: Root;
	
	const rawArgs = process.argv.slice(2);
	const args = rawArgs.filter(arg => arg !== '--');
	const hasContinue =
		args.includes('--continue') ||
		args.includes('-c') ||
		args.includes('-C');
	const resumeIndex = args.findIndex(
		arg => arg === '--resume' || arg === '-r' || arg === '-R',
	);
	const resumeTarget =
		resumeIndex >= 0 && resumeIndex + 1 < args.length
			? args[resumeIndex + 1]
			: undefined;

	if (resumeIndex >= 0 && !resumeTarget) {
		process.exit(1);
	}

	if (
		args.length === 1 &&
		(args[0] === '--version' || args[0] === '-v' || args[0] === '-V')
	) {
		return;
	}

	if (
		args.length === 1 &&
		(args[0] === '--name' || args[0] === '-n' || args[0] === '-N')
	) {
		return;
	}
	const ctx = getRenderContext(false);
	root = await createRoot(ctx.renderOptions);

	enableConfigs();
	const onboardingShown = await showSetupScreens(root);
	const { initSinks } = await import('src/utils/sinks.js');
    initSinks();

	const efrexFolder = path.join(homedir(), '.efrex');
	if (!existsSync(efrexFolder)) {
		mkdirSync(efrexFolder, { recursive: true });
	}

	const preSetupCwd = getCwd();
	await init();
	const { setup } = await import('./src/setup.js');
	await setup(preSetupCwd);

	const commands = await getCommands();
	let initialState: AppState =getDefaultAppState();
	let initialMessages: LauncherProps['initialMessages'] = undefined;

	const currentCwd = preSetupCwd;
	const resumeContext = {
		currentCwd,
		initialState,
	};

	if (hasContinue || resumeTarget) {
		try {
			const { clearSessionCaches } = await import(
				'src/commands/clear/cache.js'
			);
			clearSessionCaches();

			const resumeJsonlFile =
				resumeTarget && resumeTarget.toLowerCase().endsWith('.jsonl')
					? resumeTarget
					: undefined;
			const result = await loadConversationForResume(
				resumeTarget && !resumeJsonlFile ? resumeTarget : undefined,
				resumeJsonlFile,
			);

			if (!result) {
				console.error(
					resumeTarget
						? `Session not found: ${resumeTarget}`
						: 'No conversation found to continue.',
				);
				process.exit(1);
			}

			const loaded = await processResumedConversation(
				result,
				{
					includeAttribution: true,
					transcriptPath: result.fullPath,
				},
				resumeContext,
			);
			initialState = loaded.initialState;
			initialMessages = loaded.messages;
		} catch {
			process.exit(1);
		}
	}
	// const { checkAndRefreshOAuthTokenIfNeeded} = await import('src/utils/auth.js');
	// const {getClaudeAIOAuthTokens}=await import('src/cli/auth.js');
	// await checkAndRefreshOAuthTokenIfNeeded();
	// let apiCreds;
	// try {
    //        const accessToken = getClaudeAIOAuthTokens()?.accessToken
	// 		if (accessToken === undefined) {
	// 			throw new Error(
	// 			'Claude Code web sessions require authentication with a Claude.ai account. API key authentication is not sufficient. Please run /login to authenticate, or check your authentication status with /status.',
	// 			)
	// 		}
	// 		apiCreds = { accessToken };
    //     } catch (e) {
    //       return await exitWithError(root, `Error: ${e instanceof Error ? e.message : 'Failed to authenticate'}`, () =>
    //         gracefulShutdown(1),
    //       );
	// }
	// const getAccessToken = (): string => getClaudeAIOAuthTokens()?.accessToken ?? apiCreds?.accessToken;
	

	const launcherProps: React.ComponentProps<typeof Launcher> = {
		initialState,
		initialMessages,
		debug: false,
		thinkingConfig: { type: 'adaptive' },
		initialTools: [],
		commands,
	};

	const { errors } = getSettingsWithErrors();
	root.render(
		<StartupGate settingsErrors={errors} launcherProps={launcherProps} />,
	);
	await root.waitUntilExit();
	gracefulShutdownSync(0);
})();
