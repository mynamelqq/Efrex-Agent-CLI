import { useContext, useEffect, useRef } from 'react';
import { TerminalWriteContext } from '../ink/useTerminalNotification.js';

/**
 * Append-only scrollback logger for non-fullscreen rendering.
 *
 * The caller provides pre-rendered message chunks. Between compactions the
 * array grows monotonically, so we only emit the new tail. When the head
 * changes or the array shrinks (compact / clear / rewind), we append the full
 * new chunk array so the terminal scrollback reflects the new conversation
 * state without trying to rewrite history.
 */
export function useLogMessages(
	chunks: string[],
	ignore: boolean = false
): void {
	const writeRaw = useContext(TerminalWriteContext);
	const lastLengthRef = useRef(0);
	const firstChunkRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		if (ignore || chunks.length === 0 || !writeRaw) {
			return;
		}

		const currentFirstChunk = chunks[0];
		const previousLength = lastLengthRef.current;
		const previousFirstChunk = firstChunkRef.current;
		const isFirstRender = previousFirstChunk === undefined;
		const isIncremental =
			!isFirstRender &&
			previousFirstChunk === currentFirstChunk &&
			previousLength <= chunks.length;
		const startIndex = isIncremental ? previousLength : 0;

		if (startIndex >= chunks.length) {
			return;
		}

		const output = chunks
			.slice(startIndex)
			.filter(chunk => chunk.length > 0)
			.join('\n\n');

		if (output.length > 0) {
			writeRaw(`\n${output}\n`);
		}

		lastLengthRef.current = chunks.length;
		firstChunkRef.current = currentFirstChunk;
	}, [chunks, ignore, writeRaw]);
}
