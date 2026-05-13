import { truncate } from '../../utils/format.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { getDisplayPath } from 'src/utils/file.js';
import { GrepTool } from '../GrepTool/GrepTool.js';
import { extractTag } from 'src/utils/messages.js';
import { FallbackToolUseErrorMessage } from 'src/components/FallbackToolUseErrorMessage';
import type { ToolResultBlockParam }from "src/package/message.js"
import { MessageResponse } from 'src/components/MessageResponse.js';
import { Text } from 'src/ink.js';
import { FILE_NOT_FOUND_CWD_NOTE } from 'src/utils/file.js';
export function userFacingName(): string {
  return 'Search';
}

export function renderToolUseMessage(
  { pattern, path }: Partial<{ pattern: string; path: string }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!pattern) {
    return null;
  }
  if (!path) {
    return `pattern: "${pattern}"`;
  }
  return `pattern: "${pattern}", path: "${verbose ? path : getDisplayPath(path)}"`;
}
// Note: GlobTool reuses GrepTool's renderToolResultMessage
export const renderToolResultMessage = GrepTool.renderToolResultMessage;
export function getToolUseSummary(input: Partial<{
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  head_limit?: number;
}> | undefined): string | null {
  if (!input?.pattern) {
    return null;
  }
  return truncate(input.pattern, TOOL_SUMMARY_MAX_LENGTH);
}
export function renderToolUseErrorMessage(
  result: ToolResultBlockParam['content'],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  if (!verbose && typeof result === 'string' && extractTag(result, 'tool_use_error')) {
    const errorMessage = extractTag(result, 'tool_use_error');
    if (errorMessage?.includes(FILE_NOT_FOUND_CWD_NOTE)) {
      return (
        <MessageResponse>
          <Text color="error">File not found</Text>
        </MessageResponse>
      );
    }
    return (
      <MessageResponse>
        <Text color="error">Error searching files</Text>
      </MessageResponse>
    );
  }
  return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}