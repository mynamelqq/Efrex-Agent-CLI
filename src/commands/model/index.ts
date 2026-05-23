import type { Command } from "../../types/command"

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return 'Set the active model for this session'
  },
  argumentHint: '[model]',
  get immediate() {
    return false
  },
  load: () => import('./model.js'),
} satisfies Command
