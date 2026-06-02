/**
 * Session cache clearing utilities.
 * This module is imported at startup by main.tsx, so keep imports minimal.
 */
import { feature } from 'bun:bundle'
import {

} from '../../bootstrap/state.js'
import { getSessionStartDate } from '../../constants/common.js'
import {
  getGitStatus,
  getSystemContext,
  getUserContext,

} from '../../context.js'
import { clearStoredImagePaths } from '../../utils/imageStore.js'
/**
 * Clear all session-related caches.
 * Call this when resuming a session to ensure fresh file/skill discovery.
 * This is a subset of what clearConversation does - it only clears caches
 * without affecting messages, session ID, or triggering hooks.
 *
 * @param preservedAgentIds - Agent IDs whose per-agent state should survive
 *   the clear (e.g., background tasks preserved across /clear). When non-empty,
 *   agentId-keyed state (invoked skills) is selectively cleared and requestId-keyed
 *   state (pending permission callbacks, dump state, cache-break tracking) is left
 *   intact since it cannot be safely scoped to the main session.
 */
export function clearSessionCaches(
  preservedAgentIds: ReadonlySet<string> = new Set(),
): void {
  const hasPreserved = preservedAgentIds.size > 0
  // Clear context caches
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  getGitStatus.cache.clear?.()
  getSessionStartDate.cache.clear?.()
  // Clear stored image paths cache
  clearStoredImagePaths()
}
