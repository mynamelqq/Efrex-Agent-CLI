

import { feature } from 'bun:bundle'
import { randomUUID } from 'crypto'
import { getCwd } from '../cwd.js'
// import { getSettings_DEPRECATED } from '../settings/settings'
import { SDKMessage } from 'src/types/message.js'
// TODO(next-minor): remove this translation once SDK consumers have migrated
// to the 'Agent' tool name. The wire name was renamed Task → Agent in #19647,
// but emitting the new name in init/result events broke SDK consumers on a
// patch-level release. Keep emitting 'Task' until the next minor.
export function sdkCompatToolName(name: string): string {
  return "Agent"
}
export type SystemInitInputs = {
  tools: ReadonlyArray<{ name: string }>
  model: string
}
export function buildSystemInitMessage(inputs: SystemInitInputs): SDKMessage {

  const initMessage: SDKMessage = {
    type: 'system',
    subtype: 'init',
    cwd: getCwd(),
    tools: inputs.tools.map(tool => sdkCompatToolName(tool.name)),
    model: inputs.model,
  }
  return initMessage
}
