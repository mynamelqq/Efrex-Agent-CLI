import type { Command } from "../../types/command.js"

export default {
  type: 'local-jsx',
  name: 'effort',
  get description() {
    return 'Set effort level for model usage'
  },
  argumentHint: '[low|medium|high|xhigh|auto]',
  get immediate() {
    return false
  },
  load: () => import('./effort.js'),
} satisfies Command
