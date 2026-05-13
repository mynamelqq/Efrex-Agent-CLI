
import type { Input, Output } from './FileReadTool.js';
import { FILE_NOT_FOUND_CWD_NOTE, getDisplayPath } from 'src/utils/file.js';
import { Text } from 'src/ink.js';
import { extractTag } from 'src/utils/messages.js';
import { FallbackToolUseErrorMessage } from 'src/components/FallbackToolUseErrorMessage';
import type { ToolResultBlockParam }from "src/package/message.js"
import { FilePathLink } from 'src/components/FilePathLink';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { formatFileSize } from 'src/utils/format.js';

export function userFacingName(input: Partial<Input> | undefined): string {
  // if (input?.file_path?.startsWith(getPlansDirectory())) {
  //   return 'Reading Plan';
  // }
  // if (input?.file_path && getAgentOutputTaskId(input.file_path)) {
  //   return 'Read agent output';
  // }
  return 'Read';
}
export function getToolUseSummary(input: Partial<Input> | undefined): string | null {
  if (!input?.file_path) {
    return null;
  }
  return getDisplayPath(input.file_path);
}

export function renderToolUseMessage(
  { file_path, offset, limit, pages }: Partial<Input>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!file_path) {
    return null;
  }

  const displayPath = verbose ? file_path : getDisplayPath(file_path);
  if (pages) {
    return (
      <Text>
        <FilePathLink filePath={file_path}>{displayPath}</FilePathLink>
        {` · pages ${pages}`}
      </Text>
    );
  }
  if (verbose && (offset || limit)) {
    const startLine = offset ?? 1;
    const lineRange = limit ? `lines ${startLine}-${startLine + limit - 1}` : `from line ${startLine}`;
    return (
      <Text>
        <FilePathLink filePath={file_path}>{displayPath}</FilePathLink>
        {` · ${lineRange}`}
      </Text>
    );
  }
  return <FilePathLink filePath={file_path}>{displayPath}</FilePathLink>;
}


export function renderToolResultMessage(output: Output): React.ReactNode {
  // TODO: Render recursively
  switch (output.type) {
    case 'image': {
      const { originalSize } = output.file;
      const formattedSize = formatFileSize(originalSize);

      return (
        <MessageResponse height={1}>
          <Text>Read image ({formattedSize})</Text>
        </MessageResponse>
      );
    }
    case 'notebook': {
      const { cells } = output.file;
      if (!cells || cells.length < 1) {
        return <Text color="error">No cells found in notebook</Text>;
      }
      return (
        <MessageResponse height={1}>
          <Text>
            Read <Text bold>{cells.length}</Text> cells
          </Text>
        </MessageResponse>
      );
    }
    case 'pdf': {
      const { originalSize } = output.file;
      const formattedSize = formatFileSize(originalSize);

      return (
        <MessageResponse height={1}>
          <Text>Read PDF ({formattedSize})</Text>
        </MessageResponse>
      );
    }
    case 'parts': {
      return (
        <MessageResponse height={1}>
          <Text>
            Read <Text bold>{output.file.count}</Text> {output.file.count === 1 ? 'page' : 'pages'} (
            {formatFileSize(output.file.originalSize)})
          </Text>
        </MessageResponse>
      );
    }
    case 'text': {
      const { numLines } = output.file;

      return (
        <MessageResponse height={1}>
          <Text>
            Read <Text bold>{numLines}</Text> {numLines === 1 ? 'line' : 'lines'}
          </Text>
        </MessageResponse>
      );
    }
    case 'file_unchanged': {
      return (
        <MessageResponse height={1}>
          <Text dimColor>Unchanged since last read</Text>
        </MessageResponse>
      );
    }
  }
}
export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!verbose && typeof result === 'string') {
    // FileReadTool throws from call() so errors lack <tool_use_error> wrapping —
    // check the raw string directly for the cwd note marker.
    if (result.includes(FILE_NOT_FOUND_CWD_NOTE)) {
      return (
        <MessageResponse>
          <Text color="error">File not found</Text>
        </MessageResponse>
      );
    }
    if (extractTag(result, 'tool_use_error')) {
      return (
        <MessageResponse>
          <Text color="error">Error reading file</Text>
        </MessageResponse>
      );
    }
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
