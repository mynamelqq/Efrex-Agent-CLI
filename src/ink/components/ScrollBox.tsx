import React, {
	type PropsWithChildren,
	type Ref,
	useImperativeHandle,
	useRef,
	useState
} from 'react';
import type { Except } from 'type-fest';
import type { DOMElement } from '../dom.js';
import { markDirty, scheduleRenderFrom } from '../dom.js';
import { markCommitStart } from '../reconciler.js';
import type { Styles } from '../styles.js';
import Box from './Box.js';

export type ScrollBoxHandle = {
	scrollTo: (y: number) => void;
	scrollBy: (dy: number) => void;
	scrollToElement: (el: DOMElement, offset?: number) => void;
	scrollToBottom: () => void;
	getScrollTop: () => number;
	getPendingDelta: () => number;
	getScrollHeight: () => number;
	getFreshScrollHeight: () => number;
	getViewportHeight: () => number;
	getViewportTop: () => number;
	isSticky: () => boolean;
	subscribe: (listener: () => void) => () => void;
	setClampBounds: (
		min: number | undefined,
		max: number | undefined
	) => void;
};

export type ScrollBoxProps = Except<
	Styles,
	'textWrap' | 'overflow' | 'overflowX' | 'overflowY'
> & {
	ref?: Ref<ScrollBoxHandle>;
	stickyScroll?: boolean;
};

function ScrollBox({
	children,
	ref,
	stickyScroll,
	...style
}: PropsWithChildren<ScrollBoxProps>): React.ReactNode {
	const domRef = useRef<DOMElement>(null);
	const [, forceRender] = useState(0);
	const listenersRef = useRef(new Set<() => void>());
	const renderQueuedRef = useRef(false);

	const notify = () => {
		for (const listener of listenersRef.current) {
			listener();
		}
	};

	function scrollMutated(el: DOMElement): void {
		markDirty(el);
		markCommitStart();
		notify();
		if (renderQueuedRef.current) {
			return;
		}
		renderQueuedRef.current = true;
		queueMicrotask(() => {
			renderQueuedRef.current = false;
			scheduleRenderFrom(el);
		});
	}

	useImperativeHandle(
		ref,
		(): ScrollBoxHandle => ({
			scrollTo(y: number) {
				const el = domRef.current;
				if (!el) {
					return;
				}
				el.stickyScroll = false;
				el.pendingScrollDelta = undefined;
				el.scrollAnchor = undefined;
				el.scrollTop = Math.max(0, Math.floor(y));
				scrollMutated(el);
			},
			scrollToElement(el: DOMElement, offset = 0) {
				const box = domRef.current;
				if (!box) {
					return;
				}
				box.stickyScroll = false;
				box.pendingScrollDelta = undefined;
				box.scrollAnchor = { el, offset };
				scrollMutated(box);
			},
			scrollBy(dy: number) {
				const el = domRef.current;
				if (!el) {
					return;
				}

				const delta = Math.floor(dy);
				if (delta === 0) {
					return;
				}

				el.stickyScroll = false;
				el.scrollAnchor = undefined;

				const cur = el.scrollTop ?? 0;
				const maxScroll = Math.max(
					0,
					(el.scrollHeight ?? 0) - (el.scrollViewportHeight ?? 0)
				);
				const atTop = cur <= 0;
				const atBottom = cur >= maxScroll;
				const pending = el.pendingScrollDelta ?? 0;
				let nextPending = pending;

				if ((atTop && nextPending < 0) || (atBottom && nextPending > 0)) {
					nextPending = 0;
				}

				nextPending += delta;

				if ((atTop && nextPending < 0) || (atBottom && nextPending > 0)) {
					if (el.pendingScrollDelta !== undefined) {
						el.pendingScrollDelta = undefined;
						scrollMutated(el);
					}
					return;
				}

				el.pendingScrollDelta = nextPending === 0 ? undefined : nextPending;
				scrollMutated(el);
			},
			scrollToBottom() {
				const el = domRef.current;
				if (!el) {
					return;
				}
				el.pendingScrollDelta = undefined;
				el.stickyScroll = true;
				markDirty(el);
				notify();
				forceRender(value => value + 1);
			},
			getScrollTop() {
				return domRef.current?.scrollTop ?? 0;
			},
			getPendingDelta() {
				return domRef.current?.pendingScrollDelta ?? 0;
			},
			getScrollHeight() {
				return domRef.current?.scrollHeight ?? 0;
			},
			getFreshScrollHeight() {
				const content = domRef.current?.childNodes[0] as
					| DOMElement
					| undefined;
				return (
					content?.yogaNode?.getComputedHeight() ??
					domRef.current?.scrollHeight ??
					0
				);
			},
			getViewportHeight() {
				return domRef.current?.scrollViewportHeight ?? 0;
			},
			getViewportTop() {
				return domRef.current?.scrollViewportTop ?? 0;
			},
			isSticky() {
				const el = domRef.current;
				if (!el) {
					return false;
				}
				return el.stickyScroll ?? Boolean(el.attributes.stickyScroll);
			},
			subscribe(listener: () => void) {
				listenersRef.current.add(listener);
				return () => listenersRef.current.delete(listener);
			},
			setClampBounds(min, max) {
				const el = domRef.current;
				if (!el) {
					return;
				}
				el.scrollClampMin = min;
				el.scrollClampMax = max;
			}
		}),
		[]
	);

	return (
		<ink-box
			ref={el => {
				domRef.current = el;
				if (el) {
					el.scrollTop ??= 0;
				}
			}}
			style={{
				flexWrap: 'nowrap',
				flexDirection: style.flexDirection ?? 'row',
				flexGrow: style.flexGrow ?? 0,
				flexShrink: style.flexShrink ?? 1,
				...style,
				overflowX: 'scroll',
				overflowY: 'scroll'
			}}
			{...(stickyScroll ? { stickyScroll: true } : {})}
		>
			<Box flexDirection="column" flexGrow={1} flexShrink={0} width="100%">
				{children}
			</Box>
		</ink-box>
	);
}

export default ScrollBox;
