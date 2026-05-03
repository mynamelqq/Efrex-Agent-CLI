export function formatPastedTextLabel(index: number, text: string): string {
  const chars = text.length;
  const lines = text.split(/\r?\n/).length;
  return lines > 3
    ? `[Pasted #${index} ${lines} lines]`
    : `[Pasted #${index} ${chars} characters]`;
}
