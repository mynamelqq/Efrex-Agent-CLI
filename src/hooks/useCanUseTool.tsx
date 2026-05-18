
import { APIUserAbortError } from '@anthropic-ai/sdk';
import * as React from 'react';
import { useCallback } from 'react';
import { Text } from '@anthropic/ink';
import type {  Tool as ToolType, ToolUseContext } from '../Tool.js';
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js';
import type { AssistantMessage } from 'src/package/message.js';
import { ToolPermissionContext } from '../Tool.js';
import { logForDebugging } from '../utils/debug.js';
import { AbortError } from '../utils/errors.js';
import { ToolUseConfirm } from 'src/components/permissions/PermissionRequest.js';
import { logError } from '../utils/log.js';
import { createPermissionContext } from './toolPermission/PermissionContext.js';
import { PermissionDecision } from 'src/types/permissions.js';
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
            : hasPermissionsToUseTool(tool, input, toolUseContext, assistantMessage, toolUseID);

        return decisionPromise
          .then(async result => {

            // Has permissions to use tool, granted in config
            if (result.behavior === 'allow') {
              if (ctx.resolveIfAborted(resolve)) return;
              // Track auto mode classifier approvals for UI display
              if (
                result.decisionReason?.type === 'classifier' &&
                result.decisionReason.classifier === 'auto-mode'
              ) {
                setYoloClassifierApproval(toolUseID, result.decisionReason.reason);
              }

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
                if (
                  result.decisionReason?.type === 'classifier' &&
                  result.decisionReason.classifier === 'auto-mode'
                ) {
                  recordAutoModeDenial({
                    toolName: tool.name,
                    display: description,
                    reason: result.decisionReason.reason ?? '',
                    timestamp: Date.now(),
                  });
                  toolUseContext.addNotification?.({
                    key: 'auto-mode-denied',
                    priority: 'immediate',
                    jsx: (
                      <>
                        <Text color="error">{tool.userFacingName(input).toLowerCase()} denied by auto mode</Text>
                        <Text dimColor> · /permissions</Text>
                      </>
                    ),
                  });
                }
                resolve(result);
                return;
              }

              case 'ask': {
                // For coordinator workers, await automated checks before showing dialog.
                // Background workers should only interrupt the user when automated checks can't decide.
                if (appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog) {
                  const coordinatorDecision = await handleCoordinatorPermission({
                    ctx,
                    ...({}),
                    updatedInput: result.updatedInput,
                    suggestions: result.suggestions,
                    permissionMode: appState.toolPermissionContext.mode,
                  });
                  if (coordinatorDecision) {
                    resolve(coordinatorDecision);
                    return;
                  }
                  // null means neither automated check resolved -- fall through to dialog below.
                  // Hooks already ran, classifier already consumed.
                }

                // After awaiting automated checks, verify the request wasn't aborted
                // while we were waiting. Without this check, a stale dialog could appear.
                if (ctx.resolveIfAborted(resolve)) return;

                // For swarm workers, try classifier auto-approval then
                // forward permission requests to the leader via mailbox.
                const swarmDecision = await handleSwarmWorkerPermission({
                  ctx,
                  description,
                  ...(feature('BASH_CLASSIFIER')
                    ? {
                        pendingClassifierCheck: result.pendingClassifierCheck,
                      }
                    : {}),
                  updatedInput: result.updatedInput,
                  suggestions: result.suggestions,
                });
                if (swarmDecision) {
                  resolve(swarmDecision);
                  return;
                }

                // Grace period: wait up to 2s for speculative classifier
                // to resolve before showing the dialog (main agent only)
                if (
                  result.pendingClassifierCheck &&
                  tool.name === BASH_TOOL_NAME &&
                  !appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog
                ) {
                  const speculativePromise = peekSpeculativeClassifierCheck((input as { command: string }).command);
                  if (speculativePromise) {
                    const raceResult = await Promise.race([
                      speculativePromise.then(r => ({
                        type: 'result' as const,
                        result: r,
                      })),
                      new Promise<{ type: 'timeout' }>(res =>
                        // eslint-disable-next-line no-restricted-syntax -- resolves with a value, not void
                        setTimeout(res, 2000, { type: 'timeout' as const }),
                      ),
                    ]);

                    if (ctx.resolveIfAborted(resolve)) return;

                    if (
                      raceResult.type === 'result' &&
                      raceResult.result.matches &&
                      raceResult.result.confidence === 'high' &&
                    ) {
                      // Classifier approved within grace period — skip dialog
                      void consumeSpeculativeClassifierCheck((input as { command: string }).command);

                      const matchedRule = raceResult.result.matchedDescription ?? undefined;
                      if (matchedRule) {
                        setClassifierApproval(toolUseID, matchedRule);
                      }

          
                      resolve(
                        ctx.buildAllow(result.updatedInput ?? (input as Record<string, unknown>), {
                          decisionReason: {
                            type: 'classifier' as const,
                            classifier: 'bash_allow' as const,
                            reason: `Allowed by prompt rule: "${raceResult.result.matchedDescription}"`,
                          },
                        }),
                      );
                      return;
                    }
                    // Timeout or no match — fall through to show dialog
                  }
                }

                // Show dialog and start hooks/classifier in background
                handleInteractivePermission(
                  {
                    ctx,
                    description,
                    result,
                    awaitAutomatedChecksBeforeDialog: appState.toolPermissionContext.awaitAutomatedChecksBeforeDialog,
                    bridgeCallbacks:  undefined,
                    channelCallbacks:
                       undefined,
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
            clearClassifierChecking(toolUseID);
          });
      });
    },
    [setToolUseConfirmQueue, setToolPermissionContext],
  );
}

export default useCanUseTool;
