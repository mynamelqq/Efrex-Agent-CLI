/**
 * 通用字符串工具函数和用于安全字符串累积的类
 */

/**
 * 转义字符串中的正则表达式特殊字符，使其可以用作 RegExp 构造函数中的字面模式。
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 将字符串的首字母大写，其余部分保持不变。
 * 与 lodash 的 `capitalize` 不同，此函数不会将剩余字符转换为小写。
 *
 * @example capitalize('fooBar') → 'FooBar'
 * @example capitalize('hello world') → 'Hello world'
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * 根据数量返回单词的单数或复数形式。
 * 替代行内的 `word${n === 1 ? '' : 's'}` 习惯用法。
 *
 * @example plural(1, 'file') → 'file'
 * @example plural(3, 'file') → 'files'
 * @example plural(2, 'entry', 'entries') → 'entries'
 */
export function plural(
  n: number,
  word: string,
  pluralWord = word + 's',
): string {
  return n === 1 ? word : pluralWord
}

/**
 * 返回字符串的第一行，不分配分割数组。
 * 用于 diff 渲染中的 shebang 检测。
 */
export function firstLineOf(s: string): string {
  const nl = s.indexOf('\n')
  return nl === -1 ? s : s.slice(0, nl)
}

/**
 * 使用 indexOf 跳跃（而非逐字符迭代）计算 `char` 在 `str` 中出现的次数。
 * 结构类型设计使得 Buffer 也能工作（Buffer.indexOf 接受字符串 needles）。
 */
export function countCharInString(
  str: { indexOf(search: string, start?: number): number },
  char: string,
  start = 0,
): number {
  let count = 0
  let i = str.indexOf(char, start)
  while (i !== -1) {
    count++
    i = str.indexOf(char, i + 1)
  }
  return count
}

/**
 * 将全角数字标准化为半角数字。
 * 用于接受来自日语/CJK 输入法的输入。
 */
export function normalizeFullWidthDigits(input: string): string {
  return input.replace(/[０-９]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  )
}

/**
 * 将全角空格标准化为半角空格。
 * 用于接受来自日语/CJK 输入法的输入（U+3000 → U+0020）。
 */
export function normalizeFullWidthSpace(input: string): string {
  return input.replace(/\u3000/g, ' ')
}

// 保持内存累积适度，避免 RSS 暴涨。
// 超出此限制的内容将由 ShellCommand 溢出到磁盘。
const MAX_STRING_LENGTH = 2 ** 21

/**
 * 安全地将字符串数组与分隔符连接，如果结果超过 maxSize 则进行截断。
 *
 * @param lines 要连接的字符串数组
 * @param delimiter 字符串之间使用的分隔符（默认：','）
 * @param maxSize 结果字符串的最大大小
 * @returns 连接后的字符串，必要时会被截断
 */
export function safeJoinLines(
  lines: string[],
  delimiter: string = ',',
  maxSize: number = MAX_STRING_LENGTH,
): string {
  const truncationMarker = '...[truncated]'
  let result = ''

  for (const line of lines) {
    const delimiterToAdd = result ? delimiter : ''
    const fullAddition = delimiterToAdd + line

    if (result.length + fullAddition.length <= maxSize) {
      // 整行都能容纳
      result += fullAddition
    } else {
      // 需要截断
      const remainingSpace =
        maxSize -
        result.length -
        delimiterToAdd.length -
        truncationMarker.length

      if (remainingSpace > 0) {
        // 添加分隔符和尽可能多的行内容
        result +=
          delimiterToAdd + line.slice(0, remainingSpace) + truncationMarker
      } else {
        // 没有任何空间容纳这一行，只添加截断标记
        result += truncationMarker
      }
      return result
    }
  }
  return result
}

/**
 * 一个字符串累加器，当超过大小限制时通过从末尾截断来安全地处理大型输出。
 * 这可以防止 RangeError 崩溃，同时保留输出的开头部分。
 */
export class EndTruncatingAccumulator {
  private content: string = ''
  private isTruncated = false
  private totalBytesReceived = 0

  /**
   * 创建一个新的 EndTruncatingAccumulator
   * @param maxSize 触发截断前的最大大小（字符数）
   */
  constructor(private readonly maxSize: number = MAX_STRING_LENGTH) {}

  /**
   * 向累加器追加数据。如果总大小超过 maxSize，则截断末尾以维持大小限制。
   * @param data 要追加的字符串数据
   */
  append(data: string | Buffer): void {
    const str = typeof data === 'string' ? data : data.toString()
    this.totalBytesReceived += str.length

    // 如果已经达到容量且已截断，不再修改内容
    if (this.isTruncated && this.content.length >= this.maxSize) {
      return
    }

    // 检查添加该字符串是否会超出限制
    if (this.content.length + str.length > this.maxSize) {
      // 只追加能容纳的部分
      const remainingSpace = this.maxSize - this.content.length
      if (remainingSpace > 0) {
        this.content += str.slice(0, remainingSpace)
      }
      this.isTruncated = true
    } else {
      this.content += str
    }
  }

  /**
   * 返回累积的字符串，如果被截断则附带截断标记
   */
  toString(): string {
    if (!this.isTruncated) {
      return this.content
    }

    const truncatedBytes = this.totalBytesReceived - this.maxSize
    const truncatedKB = Math.round(truncatedBytes / 1024)
    return this.content + `\n... [output truncated - ${truncatedKB}KB removed]`
  }

  /**
   * 清除所有累积的数据
   */
  clear(): void {
    this.content = ''
    this.isTruncated = false
    this.totalBytesReceived = 0
  }

  /**
   * 返回当前累积数据的大小
   */
  get length(): number {
    return this.content.length
  }

  /**
   * 返回是否发生了截断
   */
  get truncated(): boolean {
    return this.isTruncated
  }

  /**
   * 返回接收的总字节数（截断前）
   */
  get totalBytes(): number {
    return this.totalBytesReceived
  }
}

/**
 * 将文本截断为最大行数，如果被截断则添加省略号。
 *
 * @param text 要截断的文本
 * @param maxLines 保留的最大行数
 * @returns 截断后的文本，如果被截断则添加省略号
 */
export function truncateToLines(text: string, maxLines: number): string {
  const lines = text.split('\n')
  if (lines.length <= maxLines) {
    return text
  }
  return lines.slice(0, maxLines).join('\n') + '…'
}