import { truncate } from '../../utils/format.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { getDisplayPath } from 'src/utils/file.js';
import { GrepTool } from '../GrepTool/GrepTool.js';
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