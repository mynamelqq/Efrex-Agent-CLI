
import { getSystemPrompt } from '../constants/prompts.js'
// import { getSystemContext, getUserContext } from '../context.js'//获取上下文现在还做不了
import type { AppState } from '../state/AppStateStore.js'
import type { Tools, ToolUseContext } from '../Tool.js'
import type { Message } from '../types/message.js'
import { createAbortController } from './abortController'
import type { FileStateCache } from './fileStateCache.js'
import { asSystemPrompt } from './systemPromptType.js'




export async function fetchSystemPromptParts({
  tools,
  mainLoopModel,
  customSystemPrompt,
}: {
  tools: Tools
  mainLoopModel: string
  customSystemPrompt: string | undefined
}): Promise<{
  defaultSystemPrompt: string[]
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
}> {
  const [defaultSystemPrompt, userContext, systemContext] = await Promise.all([
    customSystemPrompt !== undefined
      ? Promise.resolve([])
      : getSystemPrompt(
          tools,
          mainLoopModel,
        ),
    getUserContext(),
    customSystemPrompt !== undefined ? Promise.resolve({}) : getSystemContext(),
  ])
  return { defaultSystemPrompt, userContext, systemContext }
}