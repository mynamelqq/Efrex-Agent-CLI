#!/usr/bin/env node

/**
 * ChatUI-Cli
 * a terminal agent developed by YaQi Li(Efrewew)
 *
 * @author Yaqi Li <github.com/mynamelqq>
 */

import React from 'react';
import { attachErrorLogSink, createFileErrorSink } from './src/utils/logger.js';
import path from 'node:path';
import Launcher from './src/launcher.js';
import { init } from 'src/entrypoints/init.js';
import { homedir } from 'node:os';
import { render } from './src/ink.js';
import { existsSync, mkdirSync } from 'node:fs';

(async () => {
  attachErrorLogSink(createFileErrorSink());
  const efrexFolder=path.join(homedir(),".efrex")
  if(!existsSync(efrexFolder)){
    mkdirSync(efrexFolder, { recursive: true });
  }
  await init();
  await render(<Launcher />, {
    exitOnCtrlC: false,
    
  });
})();
