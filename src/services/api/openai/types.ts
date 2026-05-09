export type OpenAIToolSchema = {
  type?: string
  name: string
  description?: string
  input_schema?: Record<string, unknown>
  defer_loading?: boolean
  cache_control?: Record<string, unknown>
}

export type OpenAIStreamEvent = {
  type:
    | 'message_start'
    | 'content_block_start'
    | 'content_block_delta'
    | 'content_block_stop'
    | 'message_delta'
    | 'message_stop'
  [key: string]: unknown
}
