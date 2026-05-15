import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import * as React from 'react';
import { KeyboardShortcutHint } from '@anthropic/ink';
import { FallbackToolUseErrorMessage } from 'src/components/FallbackToolUseErrorMessage.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { Box, Text } from '@anthropic/ink';
import type { Tool } from 'src/Tool.js';
import type { ProgressMessage } from 'src/package/message.js';
import { env } from 'src/utils/env.js';
import { isEnvTruthy } from 'src/utils/envUtils.js';
import { getDisplayPath } from 'src/utils/file.js';
import { isFullscreenEnvEnabled } from 'src/utils/fullscreen.js';
import type { Theme,ThemeName} from 'src/utils/theme.js';
import type { BashToolInput, Out } from './BashTools.tsx';
import { BashProgress } from 'src/tools.js';
import { ShellProgressMessage } from 'src/components/shell/ShellProgressMessage.js';
import BashToolResultMessage from './BashToolResultMessage';
// Constants for command display
const MAX_COMMAND_DISPLAY_LINES = 2;
const MAX_COMMAND_DISPLAY_CHARS = 160;

export function renderToolResultMessage(
  content: Out,
  progressMessagesForMessage: ProgressMessage<BashProgress>[],
  {
    verbose,
    theme: _theme,
    tools: _tools,
    style: _style,
  }: {
    verbose: boolean;
    theme: Theme;
    tools: Tool[];
    style?: 'condensed';
  },
): React.ReactNode {
  const lastProgress = progressMessagesForMessage.at(-1);
  const timeoutMs = lastProgress?.data?.timeoutMs;
  return <BashToolResultMessage content={content} verbose={verbose} timeoutMs={timeoutMs} />;
}
export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  {
    verbose,
    progressMessagesForMessage: _progressMessagesForMessage,
    tools: _tools,
  }: {
    verbose: boolean;
    progressMessagesForMessage: ProgressMessage<BashProgress>[];
    tools: Tool[];
  },
): React.ReactNode {
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}


export function renderToolUseMessage(
  input: Partial<BashToolInput>,
  { verbose, theme: _theme }: { verbose: boolean; theme: ThemeName },
): React.ReactNode {
  const { command } = input;
  if (!command) {
    return null;
  }

  const lines = command.split('\n');

  if (isFullscreenEnvEnabled()) {
    const label = extractBashCommentLabel(command);
    if (label) {
      return label.length > MAX_COMMAND_DISPLAY_CHARS ? label.slice(0, MAX_COMMAND_DISPLAY_CHARS) + '…' : label;
    }
  }

  const needsLineTruncation = lines.length > MAX_COMMAND_DISPLAY_LINES;
  const needsCharTruncation = command.length > MAX_COMMAND_DISPLAY_CHARS;

  if (needsLineTruncation || needsCharTruncation) {
    let truncated = command;

    // First truncate by lines if needed
    if (needsLineTruncation) {
      truncated = lines.slice(0, MAX_COMMAND_DISPLAY_LINES).join('\n');
    }

    // Then truncate by chars if still too long
    if (truncated.length > MAX_COMMAND_DISPLAY_CHARS) {
      truncated = truncated.slice(0, MAX_COMMAND_DISPLAY_CHARS);
    }

    return <Text>{truncated.trim()}…</Text>;
  }

  return command;
}
export function extractBashCommentLabel(command: string): string | undefined {
  const nl = command.indexOf('\n')
  const firstLine = (nl === -1 ? command : command.slice(0, nl)).trim()
  if (!firstLine.startsWith('#') || firstLine.startsWith('#!')) return undefined
  return firstLine.replace(/^#+\s*/, '') || undefined
}
