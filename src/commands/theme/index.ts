import type { Command } from '../../types/command.js'

export default {
  type: 'local-jsx',
  name: 'theme',
  get description() {
    return 'Change the color theme'
  },
  argumentHint: '[auto|dark|light|dark-ansi|light-ansi|dark-daltonized|light-daltonized]',
  // Same reasoning as /model: keep the picker in the bottom command region so
  // opening it from the slash-completion list does not push the completion
  // rows into scrollback before the picker mounts.
  immediate: true,
  load: () => import('./theme.js'),
} satisfies Command
