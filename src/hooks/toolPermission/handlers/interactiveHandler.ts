import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { ToolUseConfirm } from 'src/components/permissions/PermissionRequest.js';
import type {
	PermissionDecision,
	PermissionUpdate
} from 'src/types/permissions.js';
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js';
import type { PermissionContext } from '../PermissionContext.js';
import { createResolveOnce } from '../PermissionContext.js';

type InteractivePermissionParams = {
	ctx: PermissionContext;
	description: string;
	result: PermissionDecision & { behavior: 'ask' };
	awaitAutomatedChecksBeforeDialog: boolean | undefined;
};

/**
 * Local interactive permission flow.
 *
 * This aligns the call site with the reference project's handler-based
 * permission pipeline, while keeping only the local queue behavior this app
 * currently supports.
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

	const toolUseConfirm: ToolUseConfirm = {
		assistantMessage: ctx.assistantMessage,
		tool: ctx.tool,
		description,
		input: displayInput,
		toolUseContext: ctx.toolUseContext,
		toolUseID: ctx.toolUseID,
		permissionResult: result,
		permissionPromptStartTimeMs,
		onUserInteraction() {
			// No async approval racers are wired yet in this local flow.
		},
		onDismissCheckmark() {
			ctx.removeFromQueue();
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
