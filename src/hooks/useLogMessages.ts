import type { UUID } from 'crypto'
import { useEffect, useRef } from 'react'
import { useAppState } from '../state/AppState.js'
import type { Message } from '../package/message.js'
import {
  cleanMessagesForLogging,
  isChainParticipant,
  recordTranscript,
} from '../utils/sessionStorage.js'

/**
 * Hook that logs messages to the transcript
 * conversation ID that only changes when a new conversation is started.
 *
 * @param messages The current conversation messages
 * @param ignore When true, messages will not be recorded to the transcript
 */
export function useLogMessages(messages: Message[], ignore: boolean = false) {//传递整个消息列表
// 在每次合并操作之间，消息的添加操作都是只增不减的，因此需要记录我们上次处理的位置，
// 并仅将新的尾部信息传递给记录转录功能。这样可以避免在每次处理时进行 O(n) 的过滤和扫描操作（每次处理约需要 20 次这样的操作，因此每次处理会浪费约 12 万次的迭代）。
  const lastRecordedLengthRef = useRef(0)
  const lastParentUuidRef = useRef<UUID | undefined>(undefined)
// 第一个 UUID 的变化 = compaction操作或 / 清除操作重新构建了数组；仅长度这一项无法检测到这种变化，因为compact操作之后的 [CB、摘要、...保留、新] 可能会比之前更长。
  const firstMessageUuidRef = useRef<UUID | undefined>(undefined)
// 防止异步的 `.then()` 方法在压缩 `.then()` 方法尚未完成执行时，被过期的同步更新所覆盖。这种情况可能发生在增量渲染操作先于压缩 `.then()` 方法的执行完成而发生的情况下。
  const callSeqRef = useRef(0)

  useEffect(() => {//message ignore变化
    if (ignore) return

    const currentFirstUuid = messages[0]?.uuid as UUID | undefined//当前第一个消息的uuid
    const prevLength = lastRecordedLengthRef.current//上一次记录的长度

  // 第一次渲染：firstMessageUuidRef 未定义。压缩操作：首次 UUID 发生变化。 // 两者都不是增量模式，但第一次渲染同步遍历是安全的（没有要保留的消息）。
    const wasFirstRender = firstMessageUuidRef.current === undefined//是否是第一次
    const isIncremental =//在非首次渲染时，第一个消息没变，并且消息列表长度没有减少
      currentFirstUuid !== undefined &&
      !wasFirstRender &&
      currentFirstUuid === firstMessageUuidRef.current &&
      prevLength <= messages.length
// 同头部压缩：墓碑过滤器、回退、截断、部分压缩。 
// 与压缩（首次 UUID 更改）不同，因为尾部要么是已存在的磁盘消息，要么是此相同效果的记录转录（完整数组）将要写入的新消息——请参阅下面的同步遍历保护机制。
    const isSameHeadShrink =
      currentFirstUuid !== undefined &&
      !wasFirstRender &&
      currentFirstUuid === firstMessageUuidRef.current &&
      prevLength > messages.length

    const startIndex = isIncremental ? prevLength : 0//起点
    if (startIndex === messages.length) return

    //在非首次渲染时，第一个消息没有变化，而且消息列表长度没有减少//第一次调用时的完整数组 + 压缩后:recordTranscript 自己的调试循环//O(n)
    //  调试循环处理消息 ToKeep 在那里正确地交织。
    const slice = startIndex === 0 ? messages : messages.slice(startIndex)
    const parentHint = isIncremental ? lastParentUuidRef.current : undefined//记录父消息

    // Fire and forget - we don't want to block the UI.
    const seq = ++callSeqRef.current
    void recordTranscript(
      slice,
      parentHint,
      messages,
    ).then(lastRecordedUuid => {
      // For compaction/full array case (!isIncremental): use the async return
      // value. After compaction, messagesToKeep in the array are skipped
      // (already in transcript), so the sync loop would find a wrong UUID.
      // Skip if a newer effect already ran (stale closure would overwrite the
      // fresher sync update from the subsequent incremental render).
      if (seq !== callSeqRef.current) return
      if (lastRecordedUuid && !isIncremental) {
        lastParentUuidRef.current = lastRecordedUuid
      }
    })

    // Sync-walk safe for: incremental (pure new-tail slice), first-render
    // (no messagesToKeep interleaving), and same-head shrink. Shrink is the
    // subtle one: the picked uuid is either already on disk (tombstone/rewind
    // — survivors were written before) or is being written by THIS effect's
    // recordTranscript(fullArray) call (snip boundary / partial-compact tail
    // — enqueueWrite ordering guarantees it lands before any later write that
    // chains to it). Without this, the ref stays stale at a tombstoned uuid:
    // the async .then() correction is raced out by the next effect's seq bump
    // on large sessions where recordTranscript(fullArray) is slow. Only the
    // compaction case (first uuid changed) remains unsafe — tail may be
    // messagesToKeep whose last-actually-recorded uuid differs.
    if (isIncremental || wasFirstRender || isSameHeadShrink) {
      // Match EXACTLY what recordTranscript persists: cleanMessagesForLogging
      // applies both the isLoggableMessage filter and (for external users) the
      // REPL-strip + isVirtual-promote transform. Using the raw predicate here
      // would pick a UUID that the transform drops, leaving the parent hint
      // pointing at a message that never reached disk. Pass full messages as
      // replId context — REPL tool_use and its tool_result land in separate
      // render cycles, so the slice alone can't pair them.
      const last = cleanMessagesForLogging(slice, messages).findLast(
        isChainParticipant,
      )
      if (last) lastParentUuidRef.current = last.uuid as UUID
    }

    lastRecordedLengthRef.current = messages.length
    firstMessageUuidRef.current = currentFirstUuid
  }, [messages, ignore, ])
}
