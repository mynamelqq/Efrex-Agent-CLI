export function formatPastedTextLabel(index: number, text: string): string {
  const lines = (text.match(/\r\n|\r|\n/g) || []).length;
  return lines > 0
    ? `[Pasted text #${index} +${lines} lines]`
    : `[Pasted text #${index}]`;
}
