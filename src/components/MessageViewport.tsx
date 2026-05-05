import React, {type Ref} from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import {stringWidth} from '../ink/stringWidth.js';
import ScrollBox, {type ScrollBoxHandle} from '../ink/components/ScrollBox.js';

export type ViewportMessage = {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  toolPhase?: 'call' | 'done' | 'error';
};

type Props = {
  headerLines?: string[];
  messages: ViewportMessage[];
  width: number;
  height: number;
  scrollBoxRef?: Ref<ScrollBoxHandle>;
  nativeScrollback?: boolean;
  alertMessage?: string | null;
  statusLine?: string | null;
};

type LineOptions = {
  headerLines?: string[];
  messages: ViewportMessage[];
  width: number;
  alertMessage?: string | null;
  statusLine?: string | null;
};

export function getMessageViewportLines({
  headerLines = [],
  messages,
  width,
  alertMessage,
  statusLine,
}: LineOptions): string[] {
  return [
    ...headerLines,
    ...(alertMessage ? [chalk.red(`错误: ${alertMessage}`)] : []),
    ...messages.flatMap(message => renderMessage(message, width)),
    ...(statusLine ? [chalk.yellow(statusLine)] : []),
  ];
}

export default function MessageViewport({
  headerLines,
  messages,
  width,
  height,
  scrollBoxRef,
  nativeScrollback = false,
  alertMessage,
  statusLine,
}: Props) {
  const lines = getMessageViewportLines({
    headerLines,
    messages,
    width,
    alertMessage,
    statusLine,
  });

  if (nativeScrollback) {
    return (
      <Box flexDirection="column" flexShrink={0}>
        {lines.map((line, index) => (
          <Text key={index} wrap="truncate-end">
            {line || ' '}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <ScrollBox
      ref={scrollBoxRef}
      lines={lines}
      width={width}
      height={height}
      stickyScroll
      showScrollbar
    />
  );
}

function renderMessage(message: ViewportMessage, width: number): string[] {
  if (message.role === 'user') {
    return [
      '',
      ...wrapPlain(message.text, Math.max(1, width - 2)).map((line, index) =>
        chalk.bgGray.white(`${index === 0 ? '> ' : '  '}${truncatePlain(line, Math.max(1, width - 2))}`),
      ),
    ];
  }

  if (message.role === 'tool') {
    const color = message.toolPhase === 'error' ? chalk.redBright : chalk.gray;
    return wrapPlain(message.text, Math.max(1, width - 3)).map((line, index) =>
      `${index === 0 ? chalk.cyanBright('↳  ') : '   '}${color(line)}`,
    );
  }

  const markdownLines = markdownToLines(message.text, Math.max(8, width - 3));
  return [
    '',
    ...markdownLines.map((line, index) => `${index === 0 ? chalk.white.bold('●  ') : '   '}${line}`),
  ];
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

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      output.push(chalk.cyanBright.bold(`${heading[1]} ${heading[2]}`));
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
      output.push(...wrapPlain(quote[1], Math.max(1, width - 2)).map(part => `${chalk.gray('│ ')}${chalk.gray(inlineStyle(part))}`));
      index++;
      continue;
    }

    const list = /^\s{0,3}(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (list) {
      const bullet = list[2] ? `${list[2]}. ` : '• ';
      output.push(...wrapPlain(list[3], Math.max(1, width - stringWidth(bullet))).map((part, partIndex) =>
        `${partIndex === 0 ? chalk.cyanBright(bullet) : ' '.repeat(stringWidth(bullet))}${inlineStyle(part)}`,
      ));
      index++;
      continue;
    }

    output.push(...wrapPlain(line.trim(), width).map(part => inlineStyle(part)));
    index++;
  }

  return output.length > 0 ? trimTrailingBlankLines(output) : [''];
}

function inlineStyle(text: string): string {
  return text
    .replace(/`([^`\n]+)`/g, (_, content: string) => chalk.bgGray.cyanBright(content))
    .replace(/\*\*([\s\S]+?)\*\*/g, (_, content: string) => chalk.magentaBright.bold(content))
    .replace(/__([\s\S]+?)__/g, (_, content: string) => chalk.magentaBright.bold(content))
    .replace(/~~([\s\S]+?)~~/g, (_, content: string) => chalk.dim.strikethrough(content))
    .replace(/\[([^\]\n]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => chalk.blueBright.underline(`${label} (${href})`))
    .replace(/\*([^*\n]+)\*/g, (_, content: string) => chalk.magenta.italic(content))
    .replace(/_([^_\n]+)_/g, (_, content: string) => chalk.magenta.italic(content));
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
  return text
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, '$1')
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

function truncateStyled(text: string, width: number): string {
  if (stringWidth(text) <= width) {
    return text;
  }

  return truncatePlain(text, width);
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
