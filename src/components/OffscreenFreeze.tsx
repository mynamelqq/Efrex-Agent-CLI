import React, { useContext, useRef } from 'react';
import { useTerminalViewport, Box } from '@anthropic/ink';
import { InVirtualListContext } from './messageActions';

type Props = {
  children: React.ReactNode;
};

/**
 * 当子项滚动到终端视口上方（回滚）时冻结它们。
 *
 * 视口上方的任何内容更改都会强制 log-update.ts 进入完整终端
 * 重置（它无法部分更新已滚出的行）。对于内容
 * 计时器的更新——旋转器、经过的计数器——这会在每次滴答时产生重置。
 *
 * 当离开屏幕时，返回在期间缓存的相同 ReactElement 引用
 * 最后可见的渲染。 React 的协调器保留相同的元素引用，因此
 * 子树永远不会重新渲染，产生零差异。
 *
 * 缓存是一个槽深：滚动回视图后第一次重新渲染
 * 捡起活着的孩子。内容在可见时仍会正常更新。
 */
export function OffscreenFreeze({ children }: Props): React.ReactNode {
  // React Compiler: reading cached.current in the return is the entire
  // freeze mechanism — memoizing this component would defeat it. Opt out.
  'use no memo';
  const inVirtualList = useContext(InVirtualListContext);
  const [ref, { isVisible }] = useTerminalViewport();
  const cached = useRef(children);
  // Virtual list has no terminal scrollback — the ScrollBox clips inside the
  // viewport, so there's nothing to freeze. Freezing there also blocks
  // click-to-expand since useTerminalViewport's visibility calc can disagree
  // with the ScrollBox's virtual scroll position.
  if (isVisible || inVirtualList) {
    cached.current = children;
  }
  return <Box ref={ref}>{cached.current}</Box>;
}
