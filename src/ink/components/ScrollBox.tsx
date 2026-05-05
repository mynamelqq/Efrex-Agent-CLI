import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';

export type ScrollBoxHandle = {
  scrollTo: (y: number) => void;
  scrollBy: (dy: number) => void;
  scrollToBottom: () => void;
  getScrollTop: () => number;
  getScrollHeight: () => number;
  getViewportHeight: () => number;
  isSticky: () => boolean;
};

type ScrollBoxProps = {
  lines: string[];
  width: number;
  height: number;
  stickyScroll?: boolean;
  showScrollbar?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const ScrollBox = forwardRef<ScrollBoxHandle, ScrollBoxProps>(function ScrollBox(
  {
    lines,
    width,
    height,
    stickyScroll = true,
    showScrollbar = true,
  },
  ref,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const stickyRef = useRef(stickyScroll);
  const previousMaxScrollRef = useRef(0);
  const scrollTopRef = useRef(0);
  const maxScrollRef = useRef(0);
  const scrollHeightRef = useRef(0);
  const viewportHeightRef = useRef(1);

  const viewportHeight = Math.max(1, Math.floor(height));
  const scrollHeight = lines.length;
  const maxScroll = Math.max(0, scrollHeight - viewportHeight);
  const effectiveScrollTop = stickyRef.current ? maxScroll : scrollTop;
  const boundedScrollTop = clamp(Math.floor(effectiveScrollTop), 0, maxScroll);

  scrollTopRef.current = boundedScrollTop;
  maxScrollRef.current = maxScroll;
  scrollHeightRef.current = scrollHeight;
  viewportHeightRef.current = viewportHeight;

  useEffect(() => {
    if (stickyScroll) {
      stickyRef.current = true;
    }
  }, [stickyScroll]);

  useEffect(() => {
    setScrollTop(previous => {
      const wasAtBottom = previous >= previousMaxScrollRef.current;
      const next = stickyRef.current || wasAtBottom
        ? maxScroll
        : clamp(previous, 0, maxScroll);

      stickyRef.current = next >= maxScroll;
      return next;
    });

    previousMaxScrollRef.current = maxScroll;
  }, [maxScroll]);

  useImperativeHandle(ref, () => ({
    scrollTo(y: number) {
      const max = maxScrollRef.current;
      const next = clamp(Math.floor(y), 0, max);
      stickyRef.current = next >= max;
      setScrollTop(next);
    },
    scrollBy(dy: number) {
      const delta = Math.floor(dy);
      if (delta === 0) {
        return;
      }

      setScrollTop(previous => {
        const max = maxScrollRef.current;
        const next = clamp(previous + delta, 0, max);
        stickyRef.current = next >= max;
        return next;
      });
    },
    scrollToBottom() {
      stickyRef.current = true;
      setScrollTop(maxScrollRef.current);
    },
    getScrollTop() {
      return scrollTopRef.current;
    },
    getScrollHeight() {
      return scrollHeightRef.current;
    },
    getViewportHeight() {
      return viewportHeightRef.current;
    },
    isSticky() {
      return stickyRef.current;
    },
  }), []);

  const visibleLines = lines.slice(
    boundedScrollTop,
    boundedScrollTop + viewportHeight,
  );
  const paddedLines = [
    ...visibleLines,
    ...Array.from(
      {length: Math.max(0, viewportHeight - visibleLines.length)},
      () => ' ',
    ),
  ];
  const scrollbarLines = getScrollbarLines({
    scrollHeight,
    viewportHeight,
    scrollTop: boundedScrollTop,
  });

  return (
    <Box flexDirection="row" height={viewportHeight} flexShrink={1} overflowY="hidden">
      <Box
        flexDirection="column"
        width={width}
        height={viewportHeight}
        flexShrink={1}
        overflowY="hidden"
      >
        {paddedLines.map((line, index) => (
          <Text key={index} wrap="truncate-end">
            {line || ' '}
          </Text>
        ))}
      </Box>
      {showScrollbar && (
        <Box flexDirection="column" width={1} height={viewportHeight} marginLeft={1} flexShrink={0}>
          {scrollbarLines.map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
});

export default ScrollBox;

function getScrollbarLines({
  scrollHeight,
  viewportHeight,
  scrollTop,
}: {
  scrollHeight: number;
  viewportHeight: number;
  scrollTop: number;
}): string[] {
  if (scrollHeight <= viewportHeight) {
    return Array.from({length: viewportHeight}, () => ' ');
  }

  const thumbHeight = Math.max(
    1,
    Math.min(viewportHeight, Math.round((viewportHeight / scrollHeight) * viewportHeight)),
  );
  const maxScroll = Math.max(1, scrollHeight - viewportHeight);
  const maxThumbTop = Math.max(0, viewportHeight - thumbHeight);
  const thumbTop = Math.round((scrollTop / maxScroll) * maxThumbTop);

  return Array.from({length: viewportHeight}, (_, index) => {
    if (index >= thumbTop && index < thumbTop + thumbHeight) {
      return chalk.blueBright('█');
    }

    return chalk.gray('│');
  });
}
