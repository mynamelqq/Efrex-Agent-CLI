import React from 'react';
import {Box, Text} from '../ink.js';
import chalk from 'chalk';
import {stringWidth} from '../ink/stringWidth.js';
import MarkdownText from './MarkdownText.js';

const USER_MESSAGE_BG = '#2e2f30';
const USER_MESSAGE_FG = '#f0f0ea';
const ASSISTANT_BRAND = '#23d3b6';

export type ViewportMessage = {
  id: number;
  role: 'user' | 'assistant' | 'tool' | 'meta';
  text: string;
  content?: React.ReactNode;
  toolPhase?: 'call' | 'done' | 'error';
  toolDisplayStyle?: 'use' | 'result' | 'progress';
  toolUseId?: string;
  animatePrefix?: 'blink';
};

type Props = {
  headerLines?: string[];
  messages: ViewportMessage[];
  width: number;
  alertMessage?: string | null;
  statusLine?: string | null;
  blinkOn?: boolean;
  variant?: 'default' | 'transcript';
};

type LineOptions = {
  headerLines?: string[];
  messages: ViewportMessage[];
  width: number;
  alertMessage?: string | null;
  statusLine?: string | null;
  blinkOn?: boolean;
  variant?: 'default' | 'transcript';
};

export function getMessageViewportLines({
  headerLines = [],
  messages,
  width,
  alertMessage,
  statusLine,
  blinkOn = false,
  variant = 'default',
}: LineOptions): string[] {
  return [
    ...headerLines,
    ...(alertMessage ? [chalk.red(`错误: ${alertMessage}`)] : []),
    ...messages.flatMap(message => renderMessage(message, width, blinkOn, variant)),
    ...(statusLine ? [chalk.yellow(statusLine)] : []),
  ];
}

export default function MessageViewport({
  headerLines,
  messages,
  width,
  alertMessage,
  statusLine,
  blinkOn = false,
  variant = 'default',
}: Props) {
  return (
    <Box flexDirection="column" flexShrink={0} width="100%">
      {headerLines?.map((line, index) => (
        <Text key={`header-${index}`} wrap="truncate-end">
          {line || ' '}
        </Text>
      ))}
      {alertMessage ? (
        <Text color="redBright">错误: {alertMessage}</Text>
      ) : null}
      {messages.map((message, index) => (
        <Box key={message.id} flexDirection="column" width="100%">
          {shouldInsertViewportSpacer(messages[index - 1], message) ? (
            <Text>{' '}</Text>
          ) : null}
          {renderMessageNode(message, width, blinkOn, variant)}
          {message.role === 'meta' && index < messages.length - 1 ? (
            <Text>{' '}</Text>
          ) : null}
        </Box>
      ))}
      {statusLine ? (
        <Text color="yellow">{statusLine}</Text>
      ) : null}
    </Box>
  );
}

function shouldInsertViewportSpacer(
  previousMessage: ViewportMessage | undefined,
  currentMessage: ViewportMessage,
): boolean {
  if (!previousMessage) {
    return false;
  }

  // Keep tool results/progress visually attached to the tool call above them.
  if (
    currentMessage.role === 'tool' &&
    currentMessage.toolDisplayStyle &&
    currentMessage.toolDisplayStyle !== 'use'
  ) {
    return false;
  }

  if (previousMessage.role === 'meta') {
    return false;
  }

  if (currentMessage.role === 'meta') {
    return true;
  }

  return true;
}

function renderMessageNode(
  message: ViewportMessage,
  width: number,
  blinkOn: boolean,
  variant: 'default' | 'transcript',
): React.ReactNode {
  if (message.role === 'meta') {
    const content = message.text ? padMetaLine(message.text, width) : ' ';
    return (
      <Text key={message.id} color="gray" dimColor wrap="truncate-end">
        {content}
      </Text>
    );
  }

  if (!message.content) {
    return renderMessage(message, width, blinkOn, variant).map((line, index) => (
      <Text key={`${message.id}-${index}`} wrap="truncate-end">
        {line || ' '}
      </Text>
    ));
  }

  if (message.role === 'user') {
    if (variant === 'transcript') {
      return (
        <Box key={message.id} flexDirection="row" width={width}>
          <Box flexShrink={0} width={5}>
            <Text color="#8b949e">you  </Text>
          </Box>
          <Box flexDirection="column" flexGrow={1} flexShrink={1} width={Math.max(1, width - 5)}>
            <MarkdownText text={message.text} width={Math.max(1, width - 5)} />
          </Box>
        </Box>
      );
    }

    return (
      <Box key={message.id} flexDirection="row" width={width}>
        <Box backgroundColor={USER_MESSAGE_BG} flexShrink={0} width={2}>
          <Text color={USER_MESSAGE_FG}>{'> '}</Text>
        </Box>
        <Box backgroundColor={USER_MESSAGE_BG} flexDirection="column" flexGrow={1} flexShrink={1} width={Math.max(1, width - 2)}>
          <MarkdownText text={message.text} width={Math.max(1, width - 2)} />
        </Box>
      </Box>
    );
  }

  if (message.role === 'assistant') {
    const assistantPrefix =
      variant === 'transcript'
        ? message.animatePrefix === 'blink'
          ? blinkOn
            ? '│  '
            : '   '
          : '│  '
        : message.animatePrefix === 'blink'
        ? blinkOn
          ? '✦  '
          : '   '
        : '✦  ';

    return (
      <Box
        key={message.id}
        flexDirection="row"
        flexWrap="nowrap"
        width={width}
      >
        <Box flexShrink={0} width={3}>
          <Text
            bold={variant !== 'transcript'}
            color={variant === 'transcript' ? '#4fd1c5' : ASSISTANT_BRAND}
          >
            {assistantPrefix}
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} width={Math.max(1, width - 3)}>
          {message.content ? (
            message.content
          ) : (
            <MarkdownText text={message.text} width={Math.max(8, width - 3)} />
          )}
        </Box>
      </Box>
    );
  }

  const { toolPrefix, prefixColor } = getToolPrefix(message, blinkOn, false, variant);

  return (
    <Box
      key={message.id}
      flexDirection="row"
      flexWrap="nowrap"
      width={width}
    >
      <Box flexShrink={0} width={3}>
        <Text color={prefixColor}>{toolPrefix}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} width={Math.max(1, width - 3)}>
        {message.content ? (
          message.content
        ) : (
          <Text wrap="wrap">{message.text || ' '}</Text>
        )}
      </Box>
    </Box>
  );
}

function renderMessage(
  message: ViewportMessage,
  width: number,
  blinkOn: boolean,
  variant: 'default' | 'transcript',
): string[] {
  if (message.role === 'meta') {
    return [chalk.gray.dim(padMetaLine(message.text, width))];
  }

  if (message.role === 'user') {
    const plainLines = plainTextToLines(
      message.text,
      variant === 'transcript' ? Math.max(1, width - 5) : Math.max(1, width - 2),
    );
    if (variant === 'transcript') {
      return plainLines.map((line, index) =>
        `${index === 0 ? chalk.hex('#8b949e')('you  ') : '     '}${chalk.hex('#c9d1d9')(line)}`,
      );
    }

    return [
      ...plainLines.map((line, index) => {
        const prefix = index === 0 ? '> ' : '  ';
        return chalk.bgHex(USER_MESSAGE_BG).hex(USER_MESSAGE_FG)(
          padPlain(`${prefix}${truncatePlain(line, Math.max(1, width - 2))}`, width),
        );
      }),
    ];
  }

  if (message.role === 'tool') {
    const color = message.toolPhase === 'error' ? chalk.redBright : chalk.gray;
    const { toolPrefix } = getToolPrefix(message, blinkOn, true, variant);

    return wrapPlain(message.text, Math.max(1, width - 3)).map((line, index) =>
      `${index === 0 ? toolPrefix : '   '}${color(line)}`,
    );
  }

  const plainLines = plainTextToLines(message.text, Math.max(8, width - 3));
  const assistantPrefix =
    variant === 'transcript'
      ? message.animatePrefix === 'blink'
        ? blinkOn
          ? chalk.hex('#4fd1c5')('│  ')
          : '   '
        : chalk.hex('#4fd1c5')('│  ')
      : message.animatePrefix === 'blink'
      ? blinkOn
        ? chalk.hex(ASSISTANT_BRAND).bold('✦  ')
        : '   '
      : chalk.hex(ASSISTANT_BRAND).bold('✦  ');

  return plainLines.map((line, index) => `${index === 0 ? assistantPrefix : '   '}${line}`);
}

function padMetaLine(text: string, width: number): string {
  const safeWidth = Math.max(1, width);
  const visibleText = truncatePlain(text, safeWidth);
  const padding = Math.max(0, safeWidth - stringWidth(visibleText));
  return `${' '.repeat(padding)}${visibleText}`;
}

function getToolPrefix(
  message: ViewportMessage,
  blinkOn: boolean,
  useChalk = false,
  variant: 'default' | 'transcript' = 'default',
): { toolPrefix: string; prefixColor: 'redBright' | 'cyanBright' | 'gray' } {
  const prefixColor =
    message.toolDisplayStyle === 'use'
      ? message.toolPhase === 'error'
        ? 'redBright'
        : 'cyanBright'
      : 'gray';
  const cyan = (value: string) => useChalk ? chalk.cyanBright(value) : value;
  const red = (value: string) => useChalk ? chalk.redBright(value) : value;
  const gray = (value: string) => useChalk ? chalk.gray(value) : value;

  if (message.toolDisplayStyle === 'use') {
    if (message.toolPhase === 'call' && message.animatePrefix === 'blink') {
      return {
        toolPrefix: blinkOn
          ? variant === 'transcript'
            ? cyan('◦  ')
            : cyan('•  ')
          : '   ',
        prefixColor,
      };
    }

    return {
      toolPrefix:
        message.toolPhase === 'error'
          ? red(variant === 'transcript' ? '◆  ' : '●  ')
          : cyan(variant === 'transcript' ? '◇  ' : '●  '),
      prefixColor,
    };
  }

  return {
    toolPrefix: gray(variant === 'transcript' ? '·  ' : '↳  '),
    prefixColor,
  };
}

function plainTextToLines(markdown: string, width: number): string[] {
  return trimTrailingBlankLines(wrapPlain(stripMarkdownSyntax(markdown), width));
}

function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, '')
    .replace(/^\s*(`{3,}|~{3,})\s*[\w.+-]*\s*$/gm, '')
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1');
}

function wrapPlain(text: string, width: number): string[] {
  return wrapStyled(text, width);
}

function wrapStyled(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const result: string[] = [];

  for (const logicalLine of text.split('\n')) {
    if (logicalLine.length === 0) {
      result.push('');
      continue;
    }

    let current = '';
    for (const char of Array.from(logicalLine)) {
      const next = current + char;
      if (stringWidth(next) > safeWidth) {
        result.push(current);
        current = char;
      } else {
        current = next;
      }
    }
    result.push(current);
  }

  return result;
}

function truncatePlain(text: string, width: number): string {
  if (stringWidth(text) <= width) {
    return text;
  }

  let output = '';
  for (const char of Array.from(text)) {
    if (stringWidth(output + char) > width - 1) {
      break;
    }
    output += char;
  }
  return `${output}…`;
}

function padPlain(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - stringWidth(text)));
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 1 && lines[end - 1] === '') {
    end--;
  }
  return lines.slice(0, end);
}
