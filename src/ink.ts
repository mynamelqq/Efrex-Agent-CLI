import {useContext, type ReactNode} from 'react';
import inkRender, {
  createRoot as inkCreateRoot,
  type Instance,
  type RenderOptions,
  type Root,
} from './ink/root.js';
import {TerminalSizeContext} from './ink/components/TerminalSizeContext.js';

export type {Instance, RenderOptions, Root};

export async function render(
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> {
  return inkRender(node, options);
}

export async function createRoot(options?: RenderOptions): Promise<Root> {
  return inkCreateRoot(options);
}

export {default as Box} from './ink/components/Box.js';
export type {Props as BoxProps} from './ink/components/Box.js';
export {default as Text} from './ink/components/Text.js';
export type {Props as TextProps} from './ink/components/Text.js';
export {Ansi} from './ink/Ansi.js';
export {default as useApp} from './ink/hooks/use-app.js';
export {default as useInput} from './ink/hooks/use-input.js';
export {default as useStdin} from './ink/hooks/use-stdin.js';
export {useTerminalFocus} from './ink/hooks/use-terminal-focus.js';
export type {Key} from './ink/events/input-event.js';

export function useWindowSize(): {columns: number; rows: number} {
  return useContext(TerminalSizeContext) ?? {
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}
