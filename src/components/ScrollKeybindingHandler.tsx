import React, { type RefObject } from 'react';
import { useInput } from '../ink.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';

type Props = {
	scrollRef: RefObject<ScrollBoxHandle | null>;
	isActive: boolean;
	onScroll?: (sticky: boolean, handle: ScrollBoxHandle) => void;
};

const WHEEL_STEP = 3;

function canScroll(handle: ScrollBoxHandle): boolean {
	return handle.getScrollHeight() > handle.getViewportHeight();
}

export function ScrollKeybindingHandler({
	scrollRef,
	isActive,
	onScroll
}: Props): React.ReactNode {
	useInput(
		(input, key, event) => {
			if (!isActive) {
				return;
			}

			const handle = scrollRef.current;
			if (!handle || !canScroll(handle)) {
				return;
			}

			let consumed = false;

			if (key.wheelUp) {
				handle.scrollBy(-WHEEL_STEP);
				consumed = true;
			} else if (key.wheelDown) {
				handle.scrollBy(WHEEL_STEP);
				consumed = true;
			} else if (key.pageUp || (key.ctrl && input === 'b')) {
				handle.scrollBy(-Math.max(1, handle.getViewportHeight() - 2));
				consumed = true;
			} else if (key.pageDown || (key.ctrl && input === 'f')) {
				handle.scrollBy(Math.max(1, handle.getViewportHeight() - 2));
				consumed = true;
			} else if (key.ctrl && input === 'u') {
				handle.scrollBy(-Math.max(1, Math.floor(handle.getViewportHeight() / 2)));
				consumed = true;
			} else if (key.ctrl && input === 'd') {
				handle.scrollBy(Math.max(1, Math.floor(handle.getViewportHeight() / 2)));
				consumed = true;
			} else if (key.home) {
				handle.scrollTo(0);
				consumed = true;
			} else if (key.end) {
				handle.scrollToBottom();
				consumed = true;
			}

			if (!consumed) {
				return;
			}

			event.stopImmediatePropagation();
			onScroll?.(handle.isSticky(), handle);
		},
		{ isActive }
	);

	return null;
}

export default ScrollKeybindingHandler;
