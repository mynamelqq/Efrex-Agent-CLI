import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { ToolUseConfirm } from 'src/components/permissions/PermissionRequest';
import type {
	PermissionDecision,
	PermissionUpdate
} from 'src/types/permissions.js';
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions';
import type { PermissionContext } from './PermissionContext';
import { createResolveOnce } from './PermissionContext';

type InteractivePermissionParams = {
	ctx: PermissionContext;
	description: string;
	result: PermissionDecision & { behavior: 'ask' };
	awaitAutomatedChecksBeforeDialog: boolean | undefined;
};

/**
 * Handles the minimal interactive permission flow.
 *
 * The simplified architecture is:
 * - push a local permission dialog to the queue
 * - resolve from user allow/reject/abort callbacks
 * - support rechecking rules while the dialog is visible
 *
 * Remote approval, hooks, classifiers, coordinator/swarm, and pipe relay are
 * intentionally excluded.
 */
function handleInteractivePermission(
	params: InteractivePermissionParams,
	resolve: (decision: PermissionDecision) => void
): void {
	const { ctx, description, result } = params;
	const {
		resolve: resolveOnce,
		isResolved,
		claim
	} = createResolveOnce(resolve);
	const permissionPromptStartTimeMs = Date.now();
	const displayInput = result.updatedInput ?? ctx.input;

	const toolUseConfirm: ToolUseConfirm = {//创建对象，然后入队
		assistantMessage: ctx.assistantMessage,
		tool: ctx.tool,
		description,
		input: displayInput,
		toolUseContext: ctx.toolUseContext,
		toolUseID: ctx.toolUseID,
		permissionResult: result,
		permissionPromptStartTimeMs,
		onUserInteraction() {
			// No automated approval racers exist in the simplified flow.
		},
		onAbort() {
			if (!claim()) return;
			ctx.logCancelled();
			resolveOnce(ctx.cancelAndAbort(undefined, true));
		},
		async onAllow(
			updatedInput,
			permissionUpdates: PermissionUpdate[],
			feedback?: string,
			contentBlocks?: ContentBlockParam[]
		) {
			if (!claim()) return;
			resolveOnce(
				await ctx.handleUserAllow(
					updatedInput,
					permissionUpdates,
					feedback,
					permissionPromptStartTimeMs,
					contentBlocks,
					result.decisionReason
				)
			);
		},
		onReject(feedback?: string, contentBlocks?: ContentBlockParam[]) {
			if (!claim()) return;
			resolveOnce(ctx.cancelAndAbort(feedback, undefined, contentBlocks));
		},
		async recheckPermission() {
			if (isResolved()) return;

			const freshResult = await hasPermissionsToUseTool(
				ctx.tool,
				ctx.input,
				ctx.toolUseContext,
				ctx.assistantMessage,
				ctx.toolUseID
			);

			if (freshResult.behavior !== 'allow') return;
			if (!claim()) return;

			ctx.removeFromQueue();
			resolveOnce(ctx.buildAllow(freshResult.updatedInput ?? ctx.input));
		}
	};

	ctx.pushToQueue(toolUseConfirm);
}

export { handleInteractivePermission };
export type { InteractivePermissionParams };
