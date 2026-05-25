

/**
 * 基于时间的微压缩功能 GrowthBook 配置。
 *
 * 当距离上一次主循环助手消息的时间间隔超过阈值时，触发内容清理型微压缩
 * 此时服务器端的提示词缓存几乎可以确定已过期，因此完整的前缀会被重新写入。
 * 在发起请求前清理旧的工具执行结果，可以减小需要重新写入的内容体积。
 *
 * 该逻辑在 API 调用**之前**执行（位于 callModel 上游的 microcompactMessages 方法中）
 * 确保发送给接口的是压缩后的精简提示词。如果在首次缓存未命中后执行，仅能对后续对话生效。
 *
 * 仅在主线程生效 —— 子代理生命周期较短，不适用基于时间间隔的清理策略。
 */
export type TimeBasedMCConfig = {
  /** 总开关。为 false 时，基于时间的微压缩功能不执行任何操作。 */
  enabled: boolean
  /** 当（当前时间 - 上一次助手消息时间戳）超过此分钟数时触发。
   *  60 是安全值：服务器端 1 小时的缓存有效期对所有用户都已确保过期
   *  因此我们绝不会触发本不会发生的缓存未命中情况。 */
  gapThresholdMinutes: number
  /** 保留最近的 N 条可压缩工具执行结果。
   *  设置后优先级高于默认值，更早的结果将被清理。 */
  keepRecent: number
}

const TIME_BASED_MC_CONFIG_DEFAULTS: TimeBasedMCConfig = {
  enabled: false,
  gapThresholdMinutes: 60,
  keepRecent: 5,
}

export function getTimeBasedMCConfig(): TimeBasedMCConfig {
  // 提前读取 GrowthBook 配置，确保在所有执行路径上都会触发配置加载
  // 而非仅当调用方满足其他条件（查询来源、消息长度）时才加载
  return TIME_BASED_MC_CONFIG_DEFAULTS

}