export function logError(error: unknown): void {
  if (process.env.EFREX_DEBUG_INK) {
    console.error(error);
  }
}
