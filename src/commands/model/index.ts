import type { Command } from "../../types/command"
// import { getMainLoopModel, renderModelName } from '../../utils/model/model.js'

export default {
  type: 'local-jsx',
  name: 'model',
  get description() {
    return `Set the AI model for Claude Code (currently})`
  },
  argumentHint: '[model]',
  get immediate() {
    return false
  },
  load: () => import('./model.js'),
} satisfies Command
