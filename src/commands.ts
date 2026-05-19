import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import model from './commands/model/index.js'
import { memoize } from 'lodash';
import { Command } from './types/command.js';
import { CommandResult } from './types/command.js';
export const COMMANDS = memoize((): Command[] => [
  model
].filter(Boolean))

