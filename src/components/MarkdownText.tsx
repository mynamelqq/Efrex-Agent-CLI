import React from 'react';
import {Text} from 'ink';

type Segment = {
  type: 'text' | 'bold' | 'italic' | 'code';
  content: string;
};

export function parseMarkdown(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  // 按顺序匹配：code > bold > italic，避免冲突
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // 添加前面的普通文本
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    const [fullMatch, code, bold, italic1, italic2] = match;
    if (code) {
      segments.push({ type: 'code', content: code.slice(1, -1) });
    } else if (bold) {
      segments.push({ type: 'bold', content: bold.slice(2, -2) });
    } else if (italic1) {
      segments.push({ type: 'italic', content: italic1.slice(1, -1) });
    } else if (italic2) {
      segments.push({ type: 'italic', content: italic2.slice(1, -1) });
    }

    lastIndex = match.index + fullMatch.length;
  }

  // 添加剩余的普通文本
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  // 如果没有匹配到任何格式，直接返回整个文本
  if (segments.length === 0) {
    return [{ type: 'text', content: text }];
  }

  return segments;
}

export default function MarkdownText({ text }: { text: string }) {
  const segments = parseMarkdown(text);

  return (
    <>
      {segments.map((segment, index) => {
        switch (segment.type) {
          case 'bold':
            return (
              <Text key={index} color="magentaBright" bold>
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
          default:
            return <Text key={index}>{segment.content}</Text>;
        }
      })}
    </>
  );
}
