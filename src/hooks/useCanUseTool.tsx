import { APIUserAbortError } from '@anthropic-ai/sdk';
import * as React from 'react';
import { useCallback } from 'react';
import { Text } from '@anthropic/ink';
import type { Tool as ToolType, ToolUseContext } from '../Tool.js';
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js';
import type { AssistantMessage } from 'src/package/message.js';
import { ToolPermissionContext } from '../Tool.js';
import { logForDebugging } from '../utils/debug.js';
import { AbortError } from '../utils/errors.js';
import { ToolUseConfirm } from 'src/components/permissions/PermissionRequest.js';
import { logError } from '../utils/log.js';
import {
  createPermissionContext,
  createPermissionQueueOps,
} from './toolPermission/PermissionContext.js';
import { handleInteractivePermission } from './toolPermission/interactiveHandler.js';
import { PermissionDecision } from 'src/types/permissions.js';
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js';
export type CanUseToolFn<Input extends Record<string, unknown> = Record<string, unknown>> = (
  tool: ToolType,
  input: Input,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  forceDecision?: PermissionDecision<Input>,
) => Promise<PermissionDecision<Input>>;

function useCanUseTool(
  setToolUseConfirmQueue: React.Dispatch<React.SetStateAction<ToolUseConfirm[]>>,//当需要用户确认时（`behavior === 'ask'`），Hook 会创建一个 `ToolUseConfirm` 对象并通过此函数推入队列
  setToolPermissionContext: (context: ToolPermissionContext) => void,
): CanUseToolFn {
  return useCallback<CanUseToolFn>(
    async (tool, input, toolUseContext, assistantMessage, toolUseID, forceDecision) => {
      return new Promise(resolve => {
        const ctx = createPermissionContext(
          tool,
          input,
          toolUseContext,
          assistantMessage,
          toolUseID,
          setToolPermissionContext,
          createPermissionQueueOps(setToolUseConfirmQueue),
        );

        if (ctx.resolveIfAborted(resolve)) return;

        const decisionPromise =
          forceDecision !== undefined
            ? Promise.resolve(forceDecision)
            : hasPermissionsToUseTool(tool, input, toolUseContext, assistantMessage, toolUseID);//是否有权利执行工具

        return decisionPromise
          .then(async result => {

            // Has permissions to use tool, granted in config
            if (result.behavior === 'allow') {
              if (ctx.resolveIfAborted(resolve)) return;
              // Track auto mode classifier approvals for UI display
              resolve(
                ctx.buildAllow(result.updatedInput ?? input, {
                  decisionReason: result.decisionReason,
                }),
              );
              return;
            }

            const appState = toolUseContext.getAppState();
            const description = await tool.description(input as never, {
              isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
              toolPermissionContext: appState.toolPermissionContext,
              tools: toolUseContext.options.tools,
            });

            if (ctx.resolveIfAborted(resolve)) return;

            // Does not have permissions to use tool, check the behavior
            switch (result.behavior) {
              case 'deny': {

                resolve(result);
                return;
              }

              case 'ask': {
                // For coordinator workers, await automated checks before showing dialog.
                // Background workers should only interrupt the user when automated checks can't decide.
                // if (appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog) {
                //   // const coordinatorDecision = await handleCoordinatorPermission({//这里有个钩子如果都失败才会弹窗让用户决定是否执行
                //   //   ctx,
                //   //   ...({}),
                //   //   updatedInput: result.updatedInput,
                //   //   suggestions: result.suggestions,
                //   //   permissionMode: appState.toolPermissionContext.mode,
                //   // });
                //   // if (coordinatorDecision) {
                //   //   resolve(coordinatorDecision);
                //   //   return;
                //   // }
                //   // null means neither automated check resolved -- fall through to dialog below.
                //   // Hooks already ran, classifier already consumed.
                // }

                // 在完成自动检查后，要确认在我们等待期间请求并未被中途终止。如果没有这一检查，可能会出现过时的对话框。
                if (ctx.resolveIfAborted(resolve)) return;
                // Grace period: wait up to 2s for speculative classifier
                // to resolve before showing the dialog (main agent only)

                // Show dialog and start hooks/classifier in background
                handleInteractivePermission(
                  {
                    ctx,
                    description,
                    result,
                    awaitAutomatedChecksBeforeDialog: appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog,
                  },
                  resolve,
                );

                return;
              }
            }
          })
          .catch(error => {
            if (error instanceof AbortError || error instanceof APIUserAbortError) {
              logForDebugging(
                `Permission check threw ${error.constructor.name} for tool=${tool.name}: ${error.message}`,
              );
              ctx.logCancelled();
              resolve(ctx.cancelAndAbort(undefined, true));
            } else {
              logError(error);
              resolve(ctx.cancelAndAbort(undefined, true));
            }
          })
          .finally(() => {
            // clearClassifierChecking(toolUseID);
          });
      });
    },
    [setToolUseConfirmQueue, setToolPermissionContext],
  );
}

export default useCanUseTool;
