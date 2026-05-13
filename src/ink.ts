import { useContext, type ReactNode } from 'react';
import inkRender, { createRoot as inkCreateRoot } from './ink/root.js';
import { TerminalSizeContext } from './ink/components/TerminalSizeContext.js';
import BoxImpl from './ink/components/Box.js';
import LinkImpl from './ink/components/Link.js';
import { NoSelect as NoSelectImpl } from './ink/components/NoSelect.js';
import TextImpl from './ink/components/Text.js';
import { Ansi as AnsiImpl } from './ink/Ansi.js';
import useAppImpl from './ink/hooks/use-app.js';
import useInputImpl from './ink/hooks/use-input.js';
import useStdinImpl from './ink/hooks/use-stdin.js';
import { useTerminalFocus as useTerminalFocusImpl } from './ink/hooks/use-terminal-focus.js';
import type {
	Instance,
	RenderOptions,
	Root,
} from './ink/root.js';
import type { Props as BoxProps } from './ink/components/Box.js';
import type { Props as TextProps } from './ink/components/Text.js';
import type { Key } from './ink/events/input-event.js';

export type { BoxProps, Instance, Key, RenderOptions, Root, TextProps };

export async function render(
	node: ReactNode,
	options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> {
	return inkRender(node, options);
}

export async function createRoot(options?: RenderOptions): Promise<Root> {
	return inkCreateRoot(options);
}

export const Box = BoxImpl;
export const Link = LinkImpl;
export const NoSelect = NoSelectImpl;
export const Text = TextImpl;
export const Ansi = AnsiImpl;
export const useApp = useAppImpl;
export const useInput = useInputImpl;
export const useStdin = useStdinImpl;
export const useTerminalFocus = useTerminalFocusImpl;

export function useWindowSize(): { columns: number; rows: number } {
	return (
		useContext(TerminalSizeContext) ?? {
			columns: process.stdout.columns ?? 80,
			rows: process.stdout.rows ?? 24,
		}
	);
}
