import React from 'react';
import {Box, Text} from '../ink.js';
import chalk from 'chalk';
import {stringWidth} from '../ink/stringWidth.js';

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
        <Box key={message.id} flexDirection="column" width={width}>
          <Text color="#8b949e" wrap="wrap">
            {`you  ${message.text}`}
          </Text>
        </Box>
      );
    }

    return (
      <Box key={message.id} flexDirection="column" width={width}>
        <Text color={USER_MESSAGE_FG} backgroundColor={USER_MESSAGE_BG} wrap="wrap">
          {`> ${message.text}`}
        </Text>
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
          {message.content}
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
        {message.content}
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
    if (variant === 'transcript') {
      return wrapPlain(message.text, Math.max(1, width - 5)).map((line, index) =>
        `${index === 0 ? chalk.hex('#8b949e')('you  ') : '     '}${chalk.hex('#c9d1d9')(line)}`,
      );
    }

    const contentWidth = Math.max(1, width - 2);
    return [
      ...wrapPlain(message.text, contentWidth).map((line, index) => {
        const prefix = index === 0 ? '> ' : '  ';
        return chalk.bgHex(USER_MESSAGE_BG).hex(USER_MESSAGE_FG)(
          padPlain(`${prefix}${truncatePlain(line, contentWidth)}`, width),
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

  const markdownLines = markdownToLines(message.text, Math.max(8, width - 3));
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

  return markdownLines.map((line, index) => `${index === 0 ? assistantPrefix : '   '}${line}`);
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

function markdownToLines(markdown: string, width: number): string[] {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const fence = /^\s*(`{3,}|~{3,})\s*([\w.+-]*)\s*$/.exec(line);

    if (fence) {
      const marker = fence[1][0];
      const language = fence[2] ?? '';
      if (language) {
        output.push(chalk.gray(language));
      }
      index++;
      while (index < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[index] ?? '')) {
        output.push(...wrapPlain(lines[index] ?? '', width).map(codeLine => chalk.bgGray.cyanBright(codeLine || ' ')));
        index++;
      }
      if (index < lines.length) {
        index++;
      }
      continue;
    }

    if (/^\s*$/.test(line)) {
      output.push('');
      index++;
      continue;
    }

    const heading = /^\s{0,3}(#{1,6})\s*(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      output.push(`${chalk.cyanBright.bold(heading[1])} ${inlineStyle(heading[2])}`);
      index++;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      output.push(chalk.gray('─'.repeat(Math.max(8, Math.min(width, 80)))));
      index++;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index++;
      }
      output.push(...renderTable(headers, rows, width));
      continue;
    }

    const quote = /^\s{0,3}>\s?(.+)$/.exec(line);
    if (quote) {
      output.push(...wrapPreservingMarkdown(quote[1], Math.max(1, width - 2)).map(part => `${chalk.gray('│ ')}${chalk.gray(inlineStyle(part))}`));
      index++;
      continue;
    }

    const list = /^\s{0,3}(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (list) {
      const bullet = list[2] ? `${list[2]}. ` : '• ';
      output.push(...wrapPreservingMarkdown(list[3], Math.max(1, width - stringWidth(bullet))).map((part, partIndex) =>
        `${partIndex === 0 ? chalk.cyanBright(bullet) : ' '.repeat(stringWidth(bullet))}${inlineStyle(part)}`,
      ));
      index++;
      continue;
    }

    output.push(...wrapPreservingMarkdown(line.trim(), width).map(part => inlineStyle(part)));
    index++;
  }

  return output.length > 0 ? trimTrailingBlankLines(output) : [''];
}

function inlineStyle(text: string): string {
  const parts: string[] = [];
  let index = 0;
  const pattern = /(`[^`\n]+`)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(~~[\s\S]+?~~)|(\[[^\]\n]+]\([^)]+\))|(\*[^*\n]+\*)|(_[^_\n]+_)/;

  while (index < text.length) {
    const remaining = text.slice(index);
    const match = pattern.exec(remaining);
    if (!match) {
      parts.push(remaining);
      break;
    }
    if (match.index > 0) {
      parts.push(remaining.slice(0, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      parts.push(chalk.bgGray.cyanBright(token.slice(1, -1)));
    } else if (token.startsWith('**') || token.startsWith('__')) {
      parts.push(chalk.magentaBright.bold(token.slice(2, -2)));
    } else if (token.startsWith('~~')) {
      parts.push(chalk.dim.strikethrough(token.slice(2, -2)));
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]\n]+)]\(([^)]+)\)$/.exec(token);
      parts.push(chalk.blueBright.underline(`${linkMatch![1]} (${linkMatch![2]})`));
    } else {
      parts.push(chalk.magenta.italic(token.slice(1, -1)));
    }
    index += match.index + token.length;
  }
  return parts.join('');
}

function renderTable(headers: string[], rows: string[][], width: number): string[] {
  const columnCount = Math.max(headers.length, ...rows.map(row => row.length));
  const normalizedHeaders = Array.from({length: columnCount}, (_, index) => stripMarkdown(headers[index] ?? ''));
  const normalizedRows = rows.map(row => Array.from({length: columnCount}, (_, index) => stripMarkdown(row[index] ?? '')));
  const maxCellWidth = Math.max(4, Math.floor((Math.max(20, width) - columnCount * 3 - 1) / columnCount));
  const columnWidths = Array.from({length: columnCount}, (_, column) => {
    const values = [normalizedHeaders[column], ...normalizedRows.map(row => row[column])];
    return Math.min(maxCellWidth, Math.max(3, ...values.map(value => stringWidth(truncatePlain(value, maxCellWidth)))));
  });
  const separator = chalk.gray(`+-${columnWidths.map(cellWidth => '-'.repeat(cellWidth)).join('-+-')}-+`);
  const renderRow = (cells: string[]) =>
    `| ${cells.map((cell, index) => padPlain(truncatePlain(cell, columnWidths[index]), columnWidths[index])).join(' | ')} |`;

  return [
    separator,
    chalk.bold(renderRow(normalizedHeaders)),
    separator,
    ...normalizedRows.map(row => renderRow(row)),
    separator,
  ];
}

function isTableStart(lines: string[], index: number): boolean {
  return isTableRow(lines[index] ?? '') && isTableSeparator(lines[index + 1] ?? '');
}

function isTableRow(line: string): boolean {
  return line.includes('|') && splitTableRow(line).length >= 2;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(cell => cell.trim());
}

function stripMarkdown(text: string): string {
  const parts: string[] = [];
  let index = 0;
  const pattern = /(`[^`\n]+`)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(~~[\s\S]+?~~)|(\[[^\]\n]+]\([^)]+\))|(\*[^*\n]+\*)|(_[^_\n]+_)/;

  while (index < text.length) {
    const remaining = text.slice(index);
    const match = pattern.exec(remaining);
    if (!match) {
      parts.push(remaining);
      break;
    }
    if (match.index > 0) {
      parts.push(remaining.slice(0, match.index));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      parts.push(token.slice(1, -1));
    } else if (token.startsWith('**') || token.startsWith('__')) {
      parts.push(token.slice(2, -2));
    } else if (token.startsWith('~~')) {
      parts.push(token.slice(2, -2));
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]\n]+)]\([^)]+\)$/.exec(token);
      parts.push(linkMatch![1]);
    } else {
      parts.push(token.slice(1, -1));
    }
    index += match.index + token.length;
  }
  return parts.join('');
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

function wrapPreservingMarkdown(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const lines = text.split('\n');
  const result: string[] = [];
  const tokenPattern = /(`[^`\n]+`)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(~~[\s\S]+?~~)|(\[[^\]\n]+]\([^)]+\))|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

  for (const line of lines) {
    if (line.length === 0) {
      result.push('');
      continue;
    }

    const segments: {text: string; atomic: boolean}[] = [];
    let lastIndex = 0;
    tokenPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = tokenPattern.exec(line)) !== null) {
      if (match.index > lastIndex) {
        segments.push({text: line.slice(lastIndex, match.index), atomic: false});
      }
      segments.push({text: match[0], atomic: true});
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < line.length) {
      segments.push({text: line.slice(lastIndex), atomic: false});
    }

    let current = '';
    for (const seg of segments) {
      if (seg.atomic) {
        if (stringWidth(current) > 0 && stringWidth(current + seg.text) > safeWidth) {
          result.push(current);
          current = seg.text;
        } else {
          current += seg.text;
        }
      } else {
        for (const char of Array.from(seg.text)) {
          if (stringWidth(current + char) > safeWidth) {
            result.push(current);
            current = char;
          } else {
            current += char;
          }
        }
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
