import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages.mjs';
import * as React from 'react';
import { Box, Text } from '../ink.js';
import { extractTag } from 'src/utils/messages.js';
import { countCharInString } from 'src/utils/stringUtils.js';
import { MessageResponse } from './MessageResponse.js';

const MAX_RENDERED_LINES = 10;

type Props = {
  result: ToolResultBlockParam['content'];
  verbose: boolean;
};

function stripUnderlineAnsi(content: string): string {
  return content.replace(
    // eslint-disable-next-line no-control-regex
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape code regex
    /\u001b\[([0-9]+;)*4(;[0-9]+)*m|\u001b\[4(;[0-9]+)*m|\u001b\[([0-9]+;)*4m/g,
    '',
  );
}

export function FallbackToolUseErrorMessage({ result, verbose }: Props): React.ReactNode {
  let error: string;

  if (typeof result !== 'string') {
    error = 'Tool execution failed';
  } else {
    const extractedError = extractTag(result, 'tool_use_error') ?? result;
    const withoutSandboxViolations = extractedError.replace(
      /<sandbox_violations(?:\s+[^>]*)?>[\s\S]*?<\/sandbox_violations>/gi,
      '',
    );
    // Strip UI-internal XML-ish tags but keep their content where useful.
    const withoutErrorTags = withoutSandboxViolations
      .replace(/<\/?error>/gi, '')
      .replace(/<\/?(?:tool_use_error|system|assistant|user)>/gi, '');
    const trimmed = withoutErrorTags.trim();
    if (!verbose && trimmed.includes('InputValidationError: ')) {
      error = 'Invalid tool parameters';
    } else if (!trimmed) {
      error = 'Tool execution failed';
    } else if (trimmed.startsWith('Error: ') || trimmed.startsWith('Cancelled: ')) {
      error = trimmed;
    } else {
      error = `Error: ${trimmed}`;
    }
  }

  const plusLines = countCharInString(error, '\n') + 1 - MAX_RENDERED_LINES;

  return (
    <MessageResponse>
      <Box flexDirection="column">
        <Text color="error">
          {stripUnderlineAnsi(verbose ? error : error.split('\n').slice(0, MAX_RENDERED_LINES).join('\n'))}
        </Text>
        {!verbose && plusLines > 0 && (
          // The careful <Text> layout is a workaround for the dim-bold
          // rendering bug
          <Box>
            <Text dimColor>
              … +{plusLines} {plusLines === 1 ? 'line' : 'lines'} (
            </Text>
            <Text dimColor>ctrl+o see all</Text>
            <Text dimColor>)</Text>
          </Box>
        )}
      </Box>
    </MessageResponse>
  );
}
