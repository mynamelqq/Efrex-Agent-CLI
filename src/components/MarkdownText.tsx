import React from 'react';
import {Box, Text} from '../ink.js';
import {stringWidth} from '../ink/stringWidth.js';

type InlineSegment = {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'strike';
  content: string;
  href?: string;
};

type MarkdownBlock =
  | {type: 'blank'}
  | {type: 'heading'; level: number; text: string}
  | {type: 'paragraph'; text: string}
  | {type: 'code'; language: string; lines: string[]}
  | {type: 'quote'; text: string}
  | {type: 'list'; ordered: boolean; items: string[]}
  | {type: 'table'; headers: string[]; rows: string[][]}
  | {type: 'hr'};

export function parseMarkdown(text: string): InlineSegment[] {
  return parseInline(text);
}

function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let index = 0;

  const pushText = (content: string) => {
    if (content) {
      segments.push({type: 'text', content});
    }
  };

  while (index < text.length) {
    const rest = text.slice(index);
    const tokenMatch = /(`[^`\n]+`)|(\*\*[\s\S]+?\*\*)|(__[\s\S]+?__)|(~~[\s\S]+?~~)|(\[[^\]\n]+\]\([^)]+\))|(\*[^*\n]+\*)|(_[^_\n]+_)/.exec(rest);

    if (!tokenMatch) {
      pushText(rest);
      break;
    }

    pushText(rest.slice(0, tokenMatch.index));
    const token = tokenMatch[0];

    if (token.startsWith('`')) {
      segments.push({type: 'code', content: token.slice(1, -1)});
    } else if (token.startsWith('**') || token.startsWith('__')) {
      segments.push({type: 'bold', content: token.slice(2, -2)});
    } else if (token.startsWith('~~')) {
      segments.push({type: 'strike', content: token.slice(2, -2)});
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]\n]+)\]\(([^)]+)\)$/.exec(token);
      segments.push({
        type: 'link',
        content: linkMatch?.[1] ?? token,
        href: linkMatch?.[2],
      });
    } else {
      segments.push({type: 'italic', content: token.slice(1, -1)});
    }

    index += tokenMatch.index + token.length;
  }

  return segments.length > 0 ? segments : [{type: 'text', content: text}];
}

function parseBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (/^\s*$/.test(line)) {
      blocks.push({type: 'blank'});
      index++;
      continue;
    }

    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w.+-]*)\s*$/.exec(line);
    if (fence) {
      const marker = fence[2][0];
      const language = fence[3] ?? '';
      const codeLines: string[] = [];
      index++;
      while (index < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '');
        index++;
      }
      if (index < lines.length) {
        index++;
      }
      blocks.push({type: 'code', language, lines: codeLines});
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({type: 'heading', level: heading[1].length, text: heading[2]});
      index++;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({type: 'hr'});
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
      blocks.push({type: 'table', headers, rows});
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index] ?? '')) {
        quoteLines.push((lines[index] ?? '').replace(/^\s{0,3}>\s?/, ''));
        index++;
      }
      blocks.push({type: 'quote', text: quoteLines.join('\n')});
      continue;
    }

    const listMatch = /^\s{0,3}(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = /^\s{0,3}(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(lines[index] ?? '');
        if (!itemMatch || Boolean(itemMatch[2]) !== ordered) {
          break;
        }
        items.push(itemMatch[3]);
        index++;
      }
      blocks.push({type: 'list', ordered, items});
      continue;
    }

    const paragraphLines = [line.trim()];
    index++;
    while (
      index < lines.length &&
      !/^\s*$/.test(lines[index] ?? '') &&
      !/^\s*(`{3,}|~{3,})/.test(lines[index] ?? '') &&
      !/^(#{1,6})\s+/.test(lines[index] ?? '') &&
      !/^\s{0,3}>\s?/.test(lines[index] ?? '') &&
      !/^\s{0,3}(?:[-+*]|\d+[.)])\s+/.test(lines[index] ?? '') &&
      !isTableStart(lines, index)
    ) {
      paragraphLines.push((lines[index] ?? '').trim());
      index++;
    }
    blocks.push({type: 'paragraph', text: paragraphLines.join(' ')});
  }

  return trimBlankBlocks(blocks);
}

function trimBlankBlocks(blocks: MarkdownBlock[]): MarkdownBlock[] {
  let start = 0;
  let end = blocks.length;
  while (start < end && blocks[start]?.type === 'blank') start++;
  while (end > start && blocks[end - 1]?.type === 'blank') end--;
  return blocks.slice(start, end);
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

function plainInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    .replace(/~~([\s\S]+?)~~/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1');
}

function padCell(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - stringWidth(value)));
}

function truncateCell(value: string, maxWidth: number): string {
  if (stringWidth(value) <= maxWidth) {
    return value;
  }

  let output = '';
  for (const char of Array.from(value)) {
    if (stringWidth(output + char) > maxWidth - 1) {
      break;
    }
    output += char;
  }
  return `${output}…`;
}

function renderInline(text: string) {
  return parseInline(text).map((segment, index) => {
    switch (segment.type) {
      case 'bold':
        return (
          <Text key={index} bold color="magentaBright">
            {segment.content}
          </Text>
        );
      case 'italic':
        return (
          <Text key={index} italic color="magenta">
            {segment.content}
          </Text>
        );
      case 'code':
        return (
          <Text key={index} backgroundColor="gray" color="cyanBright">
            {segment.content}
          </Text>
        );
      case 'link':
        return (
          <Text key={index} color="blueBright" underline>
            {segment.content}
            {segment.href ? ` (${segment.href})` : ''}
          </Text>
        );
      case 'strike':
        return (
          <Text key={index} strikethrough dimColor>
            {segment.content}
          </Text>
        );
      default:
        return <Text key={index}>{segment.content}</Text>;
    }
  });
}

function TableBlock({headers, rows, width}: {headers: string[]; rows: string[][]; width: number}) {
  const columnCount = Math.max(headers.length, ...rows.map(row => row.length));
  const normalizedRows = rows.map(row => Array.from({length: columnCount}, (_, index) => plainInline(row[index] ?? '')));
  const normalizedHeaders = Array.from({length: columnCount}, (_, index) => plainInline(headers[index] ?? ''));
  const maxCellWidth = Math.max(8, Math.floor((Math.max(20, width) - columnCount * 3 - 1) / columnCount));
  const columnWidths = Array.from({length: columnCount}, (_, column) => {
    const values = [normalizedHeaders[column], ...normalizedRows.map(row => row[column])];
    return Math.min(maxCellWidth, Math.max(3, ...values.map(value => stringWidth(truncateCell(value, maxCellWidth)))));
  });
  const separator = `+-${columnWidths.map(width => '-'.repeat(width)).join('-+-')}-+`;
  const renderRow = (cells: string[]) =>
    `| ${cells.map((cell, index) => padCell(truncateCell(cell, columnWidths[index]), columnWidths[index])).join(' | ')} |`;

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="gray">{separator}</Text>
      <Text color="white" bold>{renderRow(normalizedHeaders)}</Text>
      <Text color="gray">{separator}</Text>
      {normalizedRows.map((row, index) => (
        <Text key={index}>{renderRow(row)}</Text>
      ))}
      <Text color="gray">{separator}</Text>
    </Box>
  );
}

function CodeBlock({language, lines}: {language: string; lines: string[]}) {
  return (
    <Box flexDirection="column" marginY={1}>
      {language && <Text color="gray">{language}</Text>}
      {(lines.length > 0 ? lines : ['']).map((line, index) => (
        <Text key={index} color="cyanBright" backgroundColor="gray">
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
}

function wrapVisualLines(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const output: string[] = [];

  for (const line of text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const chars = Array.from(line);
    if (chars.length === 0) {
      output.push('');
      continue;
    }

    let current = '';
    for (const char of chars) {
      if (stringWidth(current + char) > safeWidth) {
        output.push(current);
        current = char;
      } else {
        current += char;
      }
    }
    output.push(current);
  }

  return output;
}

function MarkdownTail({text, width, maxRows}: {text: string; width: number; maxRows: number}) {
  const lines = wrapVisualLines(text, width).slice(-Math.max(1, maxRows));
  const clipped = wrapVisualLines(text, width).length > lines.length;

  return (
    <Box flexDirection="column" flexShrink={0}>
      {clipped && <Text color="gray">…</Text>}
      {lines.slice(clipped ? 1 : 0).map((line, index) => (
        <Text key={index} wrap="truncate-end">
          {renderInline(line || ' ')}
        </Text>
      ))}
    </Box>
  );
}

export default function MarkdownText({text, width = 80, maxRows}: {text: string; width?: number; maxRows?: number}) {
  if (maxRows && wrapVisualLines(text, width).length > maxRows) {
    return <MarkdownTail text={text} width={width} maxRows={maxRows} />;
  }

  const blocks = parseBlocks(text);

  return (
    <Box flexDirection="column" flexShrink={1}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'blank':
            return <Text key={index}> </Text>;
          case 'heading':
            return (
              <Text key={index} bold color={block.level <= 2 ? 'blueBright' : 'cyanBright'}>
                {renderInline(block.text)}
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={index} wrap="wrap">
                {renderInline(block.text)}
              </Text>
            );
          case 'code':
            return <CodeBlock key={index} language={block.language} lines={block.lines} />;
          case 'quote':
            return (
              <Box key={index} flexDirection="row">
                <Text color="gray">│ </Text>
                <Text color="gray" wrap="wrap">{renderInline(block.text)}</Text>
              </Box>
            );
          case 'list':
            return (
              <Box key={index} flexDirection="column">
                {block.items.map((item, itemIndex) => (
                  <Box key={itemIndex} flexDirection="row">
                    <Text color="cyanBright">{block.ordered ? `${itemIndex + 1}. ` : '• '}</Text>
                    <Text wrap="wrap">{renderInline(item)}</Text>
                  </Box>
                ))}
              </Box>
            );
          case 'table':
            return <TableBlock key={index} headers={block.headers} rows={block.rows} width={width} />;
          case 'hr':
            return <Text key={index} color="gray">{'─'.repeat(Math.max(8, Math.min(width, 80)))}</Text>;
          default:
            return null;
        }
      })}
    </Box>
  );
}
