let pendingInteractionTime: number | null = null;
let cwdState: string | null = null;
const originalCwd = process.cwd();
let lastAPIRequest: Record<string, unknown> | null = null;
let lastAPIRequestMessages: unknown[] | null = null;

export function updateLastInteractionTime(immediate = false): void {
  pendingInteractionTime = Date.now();
  if (immediate) {
    flushInteractionTime();
  }
}

export function flushInteractionTime(): void {
  pendingInteractionTime = null;
}

export function markScrollActivity(): void {
  updateLastInteractionTime();
}

export function getCwdState(): string | null {
  return cwdState;
}

export function setCwdState(cwd: string | null): void {
  cwdState = cwd;
}

export function getOriginalCwd(): string {
  return originalCwd;
}

export function getLastAPIRequest(): Record<string, unknown> | null {
  return lastAPIRequest;
}

export function setLastAPIRequest(request: Record<string, unknown> | null): void {
  lastAPIRequest = request;
}

export function getLastAPIRequestMessages(): unknown[] | null {
  return lastAPIRequestMessages;
}

export function setLastAPIRequestMessages(messages: unknown[] | null): void {
  lastAPIRequestMessages = messages;
}
