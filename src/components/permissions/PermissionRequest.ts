
import * as React from 'react';

import type { AnyObject, Tool, ToolUseContext } from '../../Tool.js';
import { BashTool } from 'src/tools/BashTool/BashTools.js';
import { FileEditTool } from 'src/tools/FileEditTool/FileEditTool.js';
import { FileReadTool } from 'src/tools/FileReadTool/FileReadTool.js';
import { FileWriteTool } from 'src/tools/FileWriteTool/FileWriteTool.js';
import { GlobTool } from 'src/tools/GlobTool/GlobTool.js';
import { GrepTool } from 'src/tools/GrepTool/GrepTool.js';
import { WebFetchTool } from 'src/tools/WebFetchTool/WebFetchTool.js';
import type { AssistantMessage } from 'src/package/message.js';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
/* eslint-enable @typescript-eslint/no-require-imports */
import type { z } from 'zod/v4';
import { PermissionDecision,PermissionUpdate } from 'src/types/permissions.js';


export type ToolUseConfirm<Input extends AnyObject = AnyObject> = {
  assistantMessage: AssistantMessage;
  tool: Tool<Input>;
  description: string;
  input: z.infer<Input>;
  toolUseContext: ToolUseContext;
  toolUseID: string;
  permissionResult: PermissionDecision;
  permissionPromptStartTimeMs: number;
  /**
   * Called when user interacts with the permission dialog (e.g., arrow keys, tab, typing).
   * This prevents async auto-approval mechanisms (like the bash classifier) from
   * dismissing the dialog while the user is actively engaging with it.
   */
  classifierCheckInProgress?: boolean;
  classifierAutoApproved?: boolean;
  classifierMatchedRule?: string;
  onUserInteraction(): void;
  onAbort(): void;
  onDismissCheckmark?(): void;
  onAllow(
    updatedInput: z.infer<Input>,
    permissionUpdates: PermissionUpdate[],
    feedback?: string,
    contentBlocks?: ContentBlockParam[],
  ): void;
  onReject(feedback?: string, contentBlocks?: ContentBlockParam[]): void;
  recheckPermission(): Promise<void>;
};