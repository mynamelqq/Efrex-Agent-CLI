import { feature } from 'bun:bundle';
import { spawnSync } from 'child_process';
import sample from 'lodash/sample.js';
import * as React from 'react';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { gracefulShutdown } from '../../utils/gracefulShutdown.js';

const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];

function getRandomGoodbyeMessage(): string {
  return sample(GOODBYE_MESSAGES) ?? 'Goodbye!';
}

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {

  const showWorktree = false; // Replace with actual logic to determine if worktree should be shown



  onDone(getRandomGoodbyeMessage());
  await gracefulShutdown(0, 'prompt_input_exit');
  return null;
}
