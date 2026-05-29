#!/usr/bin/env node

/**
 * ChatUI-Cli
 * a terminal agent developed by YaQi Li(Efrewew)
 *
 * @author Yaqi Li <github.com/mynamelqq>
 */
import { getCwd } from 'src/utils/cwd.js';
import React from 'react';
import { attachErrorLogSink, createFileErrorSink } from './src/utils/logger.js';
import path from 'node:path';
import Launcher from './src/launcher.js';
import { init } from 'src/entrypoints/init.js';
import { homedir } from 'node:os';
import { render } from './src/ink.js';
import { existsSync, mkdirSync } from 'node:fs';
import { getSettingsWithErrors } from 'src/utils/settings/settings.js';
import { InvalidSettingsDialog } from './src/components/InvalidSettingsDialog.js';

function gracefulShutdownSync(exitCode: number): never {
	process.exit(exitCode);
}

function StartupGate({
	settingsErrors,
}: {
	settingsErrors: ReturnType<typeof getSettingsWithErrors>['errors'];
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

	return <Launcher />;
}

(async () => {
  //cli.tsx
  const args = process.argv.slice(2);
  // Fast-path for --version/-v: zero module loading needed
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
    // MACRO.VERSION is inlined at build time
    console.log(`${MACRO.VERSION} (Efrex Code)`);
    return;
  }
  if (args.length === 1 && (args[0] === '--name' || args[0] === '-n' || args[0] === '-N')) {
    // MACRO.VERSION is inlined at build time
    console.log(`${MACRO.NAME}`);
    return;
  }
  //main.tsx
  attachErrorLogSink(createFileErrorSink());

  const efrexFolder=path.join(homedir(),".efrex")
  if(!existsSync(efrexFolder)){
    mkdirSync(efrexFolder, { recursive: true });
  }
  await init();
  const { setup } = await import('./src/setup.js');
  const preSetupCwd = getCwd();
  await setup(preSetupCwd)
  const { errors } = getSettingsWithErrors();

  
  const app = await render(<StartupGate settingsErrors={errors} />, {
    exitOnCtrlC: false,
    
  });
  await app.waitUntilExit();
  gracefulShutdownSync(0);
})();
