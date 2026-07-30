import * as React from 'react';
import type { LocalJSXCommandContext } from '../../types/command.js';
import { Settings } from 'src/components/Settings/Settings.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return <Settings onClose={onDone} context={context} defaultTab="Status" />;
}
