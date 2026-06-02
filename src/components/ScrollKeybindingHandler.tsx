import React, { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useInput } from '../ink.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';

type Props = {
	scrollRef: RefObject<ScrollBoxHandle | null>;
	isActive: boolean;
	onScroll?: (sticky: boolean, handle: ScrollBoxHandle) => void;
};

const BASE_WHEEL_STEP = 2;
const MAX_WHEEL_STEP = 5;
const ACCEL_THRESHOLD_MS = 80;
const MOMENTUM_FRICTION = 0.85;
const MOMENTUM_INTERVAL_MS = 30;
const MOMENTUM_MIN_VELOCITY = 0.5;

function canScroll(handle: ScrollBoxHandle): boolean {
	return handle.getScrollHeight() > handle.getViewportHeight();
}

function computeWheelStep(intervalMs: number): number {
	if (intervalMs >= ACCEL_THRESHOLD_MS) {
		return BASE_WHEEL_STEP;
	}
	// Faster scrolling → bigger step, capped at MAX_WHEEL_STEP
	const t = 1 - intervalMs / ACCEL_THRESHOLD_MS;
	return Math.round(BASE_WHEEL_STEP + t * (MAX_WHEEL_STEP - BASE_WHEEL_STEP));
}

export function ScrollKeybindingHandler({
	scrollRef,
	isActive,
	onScroll
}: Props): React.ReactNode {
	const lastWheelTimeRef = useRef(0);
	const momentumVelocityRef = useRef(0);
	const momentumDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const momentumLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const momentumDirectionRef = useRef<0 | 1 | -1>(0);

	const clearMomentum = useCallback(() => {
		if (momentumDelayRef.current !== null) {
			clearTimeout(momentumDelayRef.current);
			momentumDelayRef.current = null;
		}
		if (momentumLoopRef.current !== null) {
			clearInterval(momentumLoopRef.current);
			momentumLoopRef.current = null;
		}
		momentumVelocityRef.current = 0;
		momentumDirectionRef.current = 0;
	}, []);

	const startMomentum = useCallback(
		(direction: 1 | -1, velocity: number, handle: ScrollBoxHandle) => {
			clearMomentum();
			momentumDirectionRef.current = direction;
			momentumVelocityRef.current = velocity;

			momentumLoopRef.current = setInterval(() => {
				const v = momentumVelocityRef.current * MOMENTUM_FRICTION;
				if (Math.abs(v) < MOMENTUM_MIN_VELOCITY) {
					clearMomentum();
					return;
				}
				momentumVelocityRef.current = v;
				const delta = Math.round(v) * momentumDirectionRef.current;
				if (delta === 0) {
					clearMomentum();
					return;
				}
				handle.scrollBy(delta);
				onScroll?.(handle.isSticky(), handle);
			}, MOMENTUM_INTERVAL_MS);
		},
		[clearMomentum, onScroll]
	);

	// Clean up momentum timer on unmount or deactivation
	useEffect(() => {
		if (!isActive) {
			clearMomentum();
		}
		return clearMomentum;
	}, [isActive, clearMomentum]);

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

			if (key.wheelUp || key.wheelDown) {
				const now = Date.now();
				const interval = now - lastWheelTimeRef.current;
				lastWheelTimeRef.current = now;

				const direction: 1 | -1 = key.wheelUp ? -1 : 1;

				// Direction reversal: kill existing momentum
				if (
					momentumDirectionRef.current !== 0 &&
					momentumDirectionRef.current !== direction
				) {
					clearMomentum();
				}

				const step = computeWheelStep(interval);
				handle.scrollBy(step * direction);

				// Accumulate momentum velocity for decay after wheel stops
				momentumVelocityRef.current =
					momentumVelocityRef.current * 0.5 + step * 0.5;
				momentumDirectionRef.current = direction;

				// Reset the momentum delay — will fire if no more wheel events arrive
				if (momentumDelayRef.current !== null) {
					clearTimeout(momentumDelayRef.current);
				}
				momentumDelayRef.current = setTimeout(() => {
					if (momentumVelocityRef.current >= MOMENTUM_MIN_VELOCITY) {
						startMomentum(
							momentumDirectionRef.current as 1 | -1,
							momentumVelocityRef.current,
							handle
						);
					} else {
						clearMomentum();
					}
				}, ACCEL_THRESHOLD_MS);

				consumed = true;
			} else if (key.pageUp || (key.ctrl && input === 'b')) {
				clearMomentum();
				handle.scrollBy(-Math.max(1, handle.getViewportHeight() - 2));
				consumed = true;
			} else if (key.pageDown || (key.ctrl && input === 'f')) {
				clearMomentum();
				handle.scrollBy(Math.max(1, handle.getViewportHeight() - 2));
				consumed = true;
			} else if (key.ctrl && input === 'u') {
				clearMomentum();
				handle.scrollBy(-Math.max(1, Math.floor(handle.getViewportHeight() / 2)));
				consumed = true;
			} else if (key.ctrl && input === 'd') {
				clearMomentum();
				handle.scrollBy(Math.max(1, Math.floor(handle.getViewportHeight() / 2)));
				consumed = true;
			} else if (key.home) {
				clearMomentum();
				handle.scrollTo(0);
				consumed = true;
			} else if (key.end) {
				clearMomentum();
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
