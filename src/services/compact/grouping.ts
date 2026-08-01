import type { Message } from "src/package/message"

/**
 * 在 API 轮次边界对消息进行分组：每个 API 往返一组。
 * 当新的助手响应开始时（与之前的助手不同的 message.id），边界就会触发。对于格式良好的对话，这是一个 API 安全的分割点——API 合约要求每个 tool_use 在下一个助手轮流之前得到解决，因此配对有效性超出了助手 ID 边界。对于格式错误的输入
 * （恢复/截断后悬挂 tool_use）fork 的
 * EnsureToolResultPairing 在 API 时修复分割。
 *
 * 用更细粒度的 API 轮分组替换之前的人工轮流分组（仅在真实用户提示时边界），允许反应式紧凑在单提示代理会话（SDK/CCR/eval 调用者）上运行，其中整个工作负载是一个人工轮流。
 *
 * 提取到自己的文件以打破compact.ts↔compactMessages.ts循环（CC-1180）——该循环改变了模块初始化顺序，足以在CI shard-2中暴露出潜在的ws CJS/ESM解析竞争。
 */
export function groupMessagesByApiRound(messages: Message[]): Message[][] {
  const groups: Message[][] = []
  let current: Message[] = []
  // 最近查看的助手的 message.id。这是唯一的
  // 边界门：来自同一 API 响应的流块共享一个
  // id，因此边界仅在真正的新一轮开始时触发。
  // NormalizeMessages 为每个内容块生成一个 AssistantMessage，并且
  // StreamingToolExecutor 在实时块之间交错 tool_results
  // （yield order，而不是 concat order — 请参阅 query.ts:613）。身份证检查
  // 正确地将“[tu_A(id=X), result_A, tu_B(id=X)]”保留在一组中。
  let lastAssistantId: string | undefined


// 在格式良好的对话中，API 合约保证每个 tool_use 在下一个助手轮流之前得到解决，因此仅 lastAssistantId 就足够了。
// 跟踪未解析的 tool_use ID 仅在对话格式错误时才起作用（在从部分批次恢复或 max_tokens 截断后悬空 tool_use）
// ——在这种情况下，它将永远关闭大门，将所有后续回合合并为一组。我们让这些界限被点燃； claude.ts:1136 上的summaryr fork 自己的ensureToolResultPairing
// 修复了悬空的tu API 时间。
  for (const msg of messages) {
    if (
      msg.type === 'assistant' &&
      msg.message!.id !== lastAssistantId &&
      current.length > 0
    ) {
      groups.push(current)
      current = [msg]
    } else {
      current.push(msg)
    }
    if (msg.type === 'assistant') {
      lastAssistantId = msg.message!.id
    }
  }

  if (current.length > 0) {
    groups.push(current)
  }
  return groups
}
