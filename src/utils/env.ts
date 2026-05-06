export const env = {
  platform: process.platform,
  terminal:
    process.env.TERM_PROGRAM ??
    process.env.TERMINAL_EMULATOR ??
    process.env.TERM ??
    '',
  isCI: Boolean(process.env.CI),
};
