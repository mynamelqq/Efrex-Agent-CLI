import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import model from './commands/model/index.js'
import { memoize } from 'lodash';
import { Command } from './types/command.js';
import { isCommandEnabled } from './types/command.js';
import { CommandResult } from './types/command.js';
export const COMMANDS = memoize((): Command[] => [
  model
].filter(Boolean))
/**
 * Loads all command sources (skills, plugins, workflows). Memoized by cwd
 * because loading is expensive (disk I/O, dynamic imports).
 */
const loadAllCommands = memoize(async (): Promise<Command[]> => {
  return [
    ...COMMANDS(),
  ]
})
export type CommandResultDisplay = 'skip' | 'system' | 'user'
/**
 * Returns commands available to the current user. The expensive loading is
 * memoized, but availability and isEnabled checks run fresh every call so
 * auth changes (e.g. /login) take effect immediately.
 */
export async function getCommands(): Promise<Command[]> {
  const allCommands = await loadAllCommands()

  // Build base commands without dynamic skills
  const baseCommands = allCommands.filter(
    _ => isCommandEnabled(_),
  )
  return baseCommands
  // // Dedupe dynamic skills - only add if not already present
  // const baseCommandNames = new Set(baseCommands.map(c => c.name))
  // // Insert dynamic skills after plugin skills but before built-in commands
  // const builtInNames = new Set(COMMANDS().map(c => c.name))
  // const insertIndex = baseCommands.findIndex(c => builtInNames.has(c.name))

  // if (insertIndex === -1) {
  //   return [...baseCommands]
  // }

  // return [
  //   ...baseCommands.slice(0, insertIndex),
  //   ...baseCommands.slice(insertIndex),
  // ]
}