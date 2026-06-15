export function consumeEarlyInput(): string {
  // This app does not buffer stdin before Ink starts.
  return '';
}

export function stopCapturingEarlyInput(): void {
  // This app does not buffer stdin before Ink starts.
}
