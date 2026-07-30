import type { Command } from "../../types/command"

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return 'Set the active model for this session'
  },
  argumentHint: '[model]',
  // Keep the picker in the bottom command region so opening it from the
  // slash-completion list does not move the old completion rows into
  // scrollback before the picker is mounted.
  immediate: true,
  load: () => import('./model.js'),
} satisfies Command
