import type { RefObject } from 'react';
import {
	useCallback,
	useDeferredValue,
	useLayoutEffect,
	useMemo,
	useRef,
	useSyncExternalStore
} from 'react';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import type { DOMElement } from '../ink/dom.js';

const DEFAULT_ESTIMATE = 3;
const OVERSCAN_ROWS = 40;
const COLD_START_COUNT = 30;
const SCROLL_QUANTUM = OVERSCAN_ROWS >> 1;
const PESSIMISTIC_HEIGHT = 1;
const MAX_MOUNTED_ITEMS = 200;
const SLIDE_STEP = 25;
const NOOP_UNSUB = () => {};

export type VirtualScrollResult = {
	range: readonly [number, number];
	topSpacer: number;
	bottomSpacer: number;
	measureRef: (key: string) => (el: DOMElement | null) => void;
	spacerRef: RefObject<DOMElement | null>;
};

export function useVirtualScroll(
	scrollRef: RefObject<ScrollBoxHandle | null>,
	itemKeys: readonly string[],
	columns: number
): VirtualScrollResult {
	const heightCache = useRef(new Map<string, number>());
	const offsetVersionRef = useRef(0);
	const lastScrollTopRef = useRef(0);
	const offsetsRef = useRef<{ arr: Float64Array; version: number; n: number }>(
		{
			arr: new Float64Array(0),
			version: -1,
			n: -1
		}
	);
	const itemRefs = useRef(new Map<string, DOMElement>());
	const refCache = useRef(new Map<string, (el: DOMElement | null) => void>());
	const prevColumns = useRef(columns);
	const skipMeasurementRef = useRef(false);
	const prevRangeRef = useRef<readonly [number, number] | null>(null);
	const freezeRendersRef = useRef(0);
	if (prevColumns.current !== columns) {
		const ratio = prevColumns.current / columns;
		prevColumns.current = columns;
		for (const [key, height] of heightCache.current) {
			heightCache.current.set(key, Math.max(1, Math.round(height * ratio)));
		}
		offsetVersionRef.current++;
		skipMeasurementRef.current = true;
		freezeRendersRef.current = 2;
	}
	const frozenRange =
		freezeRendersRef.current > 0 ? prevRangeRef.current : null;
	const listOriginRef = useRef(0);
	const spacerRef = useRef<DOMElement | null>(null);

	const subscribe = useCallback(
		(listener: () => void) =>
			scrollRef.current?.subscribe(listener) ?? NOOP_UNSUB,
		[scrollRef]
	);
	useSyncExternalStore(subscribe, () => {
		const handle = scrollRef.current;
		if (!handle) {
			return NaN;
		}
		const target = handle.getScrollTop() + handle.getPendingDelta();
		const bin = Math.floor(target / SCROLL_QUANTUM);
		return handle.isSticky() ? ~bin : bin;
	});

	const scrollTop = scrollRef.current?.getScrollTop() ?? -1;
	const pendingDelta = scrollRef.current?.getPendingDelta() ?? 0;
	const viewportHeight = scrollRef.current?.getViewportHeight() ?? 0;
	const isSticky = scrollRef.current?.isSticky() ?? true;

	useMemo(() => {
		const liveKeys = new Set(itemKeys);
		let dirty = false;
		for (const key of heightCache.current.keys()) {
			if (!liveKeys.has(key)) {
				heightCache.current.delete(key);
				dirty = true;
			}
		}
		for (const key of refCache.current.keys()) {
			if (!liveKeys.has(key)) {
				refCache.current.delete(key);
			}
		}
		if (dirty) {
			offsetVersionRef.current++;
		}
	}, [itemKeys]);

	const count = itemKeys.length;
	if (
		offsetsRef.current.version !== offsetVersionRef.current ||
		offsetsRef.current.n !== count
	) {
		const arr =
			offsetsRef.current.arr.length >= count + 1
				? offsetsRef.current.arr
				: new Float64Array(count + 1);
		arr[0] = 0;
		for (let index = 0; index < count; index++) {
			arr[index + 1] =
				arr[index]! +
				(heightCache.current.get(itemKeys[index]!) ?? DEFAULT_ESTIMATE);
		}
		offsetsRef.current = {
			arr,
			version: offsetVersionRef.current,
			n: count
		};
	}
	const offsets = offsetsRef.current.arr;
	const totalHeight = offsets[count]!;

	let start: number;
	let end: number;

	if (frozenRange) {
		[start, end] = frozenRange;
		start = Math.min(start, count);
		end = Math.min(end, count);
	} else if (viewportHeight === 0 || scrollTop < 0) {
		start = Math.max(0, count - COLD_START_COUNT);
		end = count;
	} else if (isSticky) {
		const budget = viewportHeight + OVERSCAN_ROWS;
		start = count;
		while (start > 0 && totalHeight - offsets[start - 1]! < budget) {
			start--;
		}
		end = count;
	} else {
		const listOrigin = listOriginRef.current;
		const maxSpanRows = viewportHeight * 3;
		const rawLow = Math.min(scrollTop, scrollTop + pendingDelta);
		const rawHigh = Math.max(scrollTop, scrollTop + pendingDelta);
		const span = rawHigh - rawLow;
		const clampedLow =
			span > maxSpanRows
				? pendingDelta < 0
					? rawHigh - maxSpanRows
					: rawLow
				: rawLow;
		const clampedHigh = clampedLow + Math.min(span, maxSpanRows);
		const effectiveLow = Math.max(0, clampedLow - listOrigin);
		const effectiveHigh = clampedHigh - listOrigin;
		const low = effectiveLow - OVERSCAN_ROWS;

		let left = 0;
		let right = count;
		while (left < right) {
			const middle = (left + right) >> 1;
			if (offsets[middle + 1]! <= low) {
				left = middle + 1;
			} else {
				right = middle;
			}
		}
		start = left;

		const previousRange = prevRangeRef.current;
		if (previousRange && previousRange[0] < start) {
			for (
				let index = previousRange[0];
				index < Math.min(start, previousRange[1]);
				index++
			) {
				const key = itemKeys[index]!;
				if (itemRefs.current.has(key) && !heightCache.current.has(key)) {
					start = index;
					break;
				}
			}
		}

		const needed = viewportHeight + 2 * OVERSCAN_ROWS;
		const maxEnd = Math.min(count, start + MAX_MOUNTED_ITEMS);
		let coverage = 0;
		end = start;
		while (
			end < maxEnd &&
			(coverage < needed ||
				offsets[end]! < effectiveHigh + viewportHeight + OVERSCAN_ROWS)
		) {
			coverage +=
				heightCache.current.get(itemKeys[end]!) ?? PESSIMISTIC_HEIGHT;
			end++;
		}
	}

	const needed = viewportHeight + 2 * OVERSCAN_ROWS;
	const minStart = Math.max(0, end - MAX_MOUNTED_ITEMS);
	let coverage = 0;
	for (let index = start; index < end; index++) {
		coverage +=
			heightCache.current.get(itemKeys[index]!) ?? PESSIMISTIC_HEIGHT;
	}
	while (start > minStart && coverage < needed) {
		start--;
		coverage +=
			heightCache.current.get(itemKeys[start]!) ?? PESSIMISTIC_HEIGHT;
	}

	const previousRange = prevRangeRef.current;
	const scrollVelocity =
		Math.abs(scrollTop - lastScrollTopRef.current) + Math.abs(pendingDelta);
	if (previousRange && scrollVelocity > viewportHeight * 2) {
		const [prevStart, prevEnd] = previousRange;
		if (start < prevStart - SLIDE_STEP) {
			start = prevStart - SLIDE_STEP;
		}
		if (end > prevEnd + SLIDE_STEP) {
			end = prevEnd + SLIDE_STEP;
		}
		if (start > end) {
			end = Math.min(start + SLIDE_STEP, count);
		}
	}
	lastScrollTopRef.current = scrollTop;

	if (freezeRendersRef.current > 0) {
		freezeRendersRef.current--;
	} else {
		prevRangeRef.current = [start, end];
	}

	const deferredStart = useDeferredValue(start);
	const deferredEnd = useDeferredValue(end);
	let effectiveStart = start < deferredStart ? deferredStart : start;
	let effectiveEnd = end > deferredEnd ? deferredEnd : end;
	if (effectiveStart > effectiveEnd || isSticky) {
		effectiveStart = start;
		effectiveEnd = end;
	}
	if (pendingDelta > 0) {
		effectiveEnd = end;
	}
	if (effectiveEnd - effectiveStart > MAX_MOUNTED_ITEMS) {
		const mid =
			(offsets[effectiveStart]! + offsets[effectiveEnd]!) / 2;
		if (scrollTop - listOriginRef.current < mid) {
			effectiveEnd = effectiveStart + MAX_MOUNTED_ITEMS;
		} else {
			effectiveStart = effectiveEnd - MAX_MOUNTED_ITEMS;
		}
	}

	const listOrigin = listOriginRef.current;
	const topSpacer = offsets[effectiveStart]!;
	const clampMin = effectiveStart === 0 ? 0 : topSpacer + listOrigin;
	const clampMax =
		effectiveEnd === count
			? Infinity
			: Math.max(topSpacer, offsets[effectiveEnd]! - viewportHeight) +
				listOrigin;
	useLayoutEffect(() => {
		if (isSticky) {
			scrollRef.current?.setClampBounds(undefined, undefined);
		} else {
			scrollRef.current?.setClampBounds(clampMin, clampMax);
		}
	});

	useLayoutEffect(() => {
		const spacerYoga = spacerRef.current?.yogaNode;
		if (spacerYoga && spacerYoga.getComputedWidth() > 0) {
			listOriginRef.current = spacerYoga.getComputedTop();
		}
		if (skipMeasurementRef.current) {
			skipMeasurementRef.current = false;
			return;
		}

		let changed = false;
		for (const [key, element] of itemRefs.current) {
			const yoga = element.yogaNode;
			if (!yoga) {
				continue;
			}
			const height = yoga.getComputedHeight();
			const previous = heightCache.current.get(key);
			if (height > 0) {
				if (previous !== height) {
					heightCache.current.set(key, height);
					changed = true;
				}
			} else if (yoga.getComputedWidth() > 0 && previous !== 0) {
				heightCache.current.set(key, 0);
				changed = true;
			}
		}

		if (changed) {
			offsetVersionRef.current++;
		}
	});

	const measureRef = useCallback((key: string) => {
		let fn = refCache.current.get(key);
		if (!fn) {
			fn = (element: DOMElement | null) => {
				if (element) {
					itemRefs.current.set(key, element);
					return;
				}

				const yoga = itemRefs.current.get(key)?.yogaNode;
				if (yoga && !skipMeasurementRef.current) {
					const height = yoga.getComputedHeight();
					if (
						(height > 0 || yoga.getComputedWidth() > 0) &&
						heightCache.current.get(key) !== height
					) {
						heightCache.current.set(key, height);
						offsetVersionRef.current++;
					}
				}
				itemRefs.current.delete(key);
			};
			refCache.current.set(key, fn);
		}
		return fn;
	}, []);

	return {
		range: [effectiveStart, effectiveEnd] as const,
		topSpacer,
		bottomSpacer: Math.max(0, totalHeight - offsets[effectiveEnd]!),
		measureRef,
		spacerRef
	};
}
