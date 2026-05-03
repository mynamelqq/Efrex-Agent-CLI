
import { ChatCompletionChunk, ChatCompletionContentPart } from "openai/resources"
import { Tools } from "./Tool"
import { createAbortController } from "./abortController"
import {setCwd}from "./utils/shell"
import type { Message } from './types/message'
export type QueryEngineConfig = {
  cwd: string
  tools: Tools
//   private totalUsage: NonNullableUsage
//   commands: Command[]
  customSystemPrompt?: string
  appendSystemPrompt?: string
  maxTurns?: number
  maxBudgetUsd?: number
  initialMessages?: Message[]
  jsonSchema?: Record<string, unknown>
  verbose?: boolean
  replayUserMessages?: boolean
  abortController?: AbortController
}

export class queryEngine{
    private config: QueryEngineConfig
    private abortController:AbortController;
    private mutableMessages:Message[];

    constructor(queryEngineConfig:QueryEngineConfig){
        this.config=queryEngineConfig
        this.abortController=queryEngineConfig.abortController ?? createAbortController()
        // this.totalUsage = EMPTY_USAGE
        this.mutableMessages = queryEngineConfig.initialMessages ?? []
    }
    async *submitMessage(
        prompt: string | ChatCompletionContentPart[],
        options?: { uuid?: string; isMeta?: boolean },
    ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
        const {
            cwd,
            tools,
            verbose = false,
            maxTurns,
            maxBudgetUsd,
            customSystemPrompt,
            appendSystemPrompt,
            jsonSchema,
            replayUserMessages = false,
        } = this.config
        setCwd(cwd)//设置当前的工作路径
        const startTime = Date.now()
        

    }
}