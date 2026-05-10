import React, { useCallback, useEffect, useRef, useState } from 'react'
import chalk from 'chalk'
import { randomUUID } from 'node:crypto'
import { Box, Text, useApp, useInput, useWindowSize } from './ink.js'
import { stringWidth } from './ink/stringWidth.js'
import PromptInput from './components/PromptInput.js'
import MessageViewport from './components/MessageViewport.js'
import { parseCommand } from './commands.js'
import type { Message } from './package/message.js'
import { query } from './query.js'
import type { ToolUseContext } from './Tool.js'
import { getAllBaseTools } from './tools.js'
import { createUserMessage } from './utils/messages.js'
import { getAnthropicModel, getEffortLevel } from './utils/anthropicConfig.js'
import { FileStateCache } from './utils/fileStateCache.js'
import { getDefaultAppState, type AppState } from './state/AppStateStore.js'

type ViewportMessage = {
  id: number
  role: 'user' | 'assistant' | 'tool'
  text: string
  toolPhase?: 'call' | 'done' | 'error'
  animatePrefix?: 'blink'
}

type StreamingAssistantState = {
  active: boolean
  placeholderId: number | null
  text: string
  pendingToolCalls: string[]
}

const INPUT_MARGIN_ROWS = 1
const INPUT_RULE_ROWS = 2
const FOOTER_ROWS = 2
const MIN_MESSAGE_VIEWPORT_ROWS = 1
const MAX_PROMPT_INPUT_ROWS = 6
const COMMAND_SELECTOR_LIMIT = 5

const commands = [
  { label: '/model                         Change Your Model', value: '/model' },
  { label: '/help                          Show help and available commands', value: '/help' },
]

const DEFAULT_SYSTEM_PROMPT = [
  'You are Efrex, a terminal coding assistant.',
  'Be concise, accurate, and use available tools when needed. Now your current work path is F:\\ChatUI-Cli',
].join('\n')

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const GLIMMER_PAD_COLUMNS = 10
const GLIMMER_WIDTH_COLUMNS = 8
const statusSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' })
    : null

function getCurrentModel(): string {
  return getAnthropicModel()
}

function splitGraphemes(text: string): string[] {
  if (statusSegmenter) {
    return Array.from(statusSegmenter.segment(text), segment => segment.segment)
  }

  return Array.from(text)
}

function getShimmerSegments(
  text: string,
  glimmerIndex: number,
): { before: string; shimmer: string; after: string } {
  const graphemes = splitGraphemes(text)
  const shimmerStart = glimmerIndex
  const shimmerEnd = glimmerIndex + GLIMMER_WIDTH_COLUMNS

  let cursor = 0
  const before: string[] = []
  const shimmer: string[] = []
  const after: string[] = []

  for (const grapheme of graphemes) {
    const width = stringWidth(grapheme)
    const nextCursor = cursor + width
    const intersects = nextCursor > shimmerStart && cursor < shimmerEnd

    if (intersects) {
      shimmer.push(grapheme)
    } else if (nextCursor <= shimmerStart) {
      before.push(grapheme)
    } else {
      after.push(grapheme)
    }

    cursor = nextCursor
  }

  return {
    before: before.join(''),
    shimmer: shimmer.join(''),
    after: after.join(''),
  }
}

function getStatusLabelSegments(
  text: string,
  glimmerIndex: number,
): { before: string; shimmer: string; after: string } {
  return getShimmerSegments(text, glimmerIndex)
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function countWrappedRows(text: string, width: number): number {
  if (text.length === 0) {
    return 1
  }

  const safeWidth = Math.max(1, width)
  return normalizeLineEndings(text)
    .split('\n')
    .reduce((rows, logicalLine) => {
      if (logicalLine.length === 0) {
        return rows + 1
      }

      let lineWidth = 0
      let visualRows = 1
      for (const char of Array.from(logicalLine)) {
        const charWidth = char.length
        if (lineWidth > 0 && lineWidth + charWidth > safeWidth) {
          visualRows++
          lineWidth = charWidth
        } else {
          lineWidth += charWidth
        }
      }

      return rows + visualRows
    }, 0)
}

function truncateDisplay(text: string, width: number): string {
  if (text.length <= width) {
    return text
  }

  return `${text.slice(0, Math.max(0, width - 1))}…`
}

function getTranscriptHeaderLines({
  cwd,
  model,
  effort,
  width,
}: {
  cwd: string
  model: string
  effort: string
  width: number
}): string[] {
  const boxWidth = Math.max(12, width)
  const innerWidth = Math.max(1, boxWidth - 2)
  const border = '─'.repeat(innerWidth)
  const title = `${chalk.blueBright.bold('Efrex')} ${chalk.gray('query main UI')}`
  const meta = chalk.gray(
    truncateDisplay(`${cwd}  ·  model: ${model}  ·  effort: ${effort}`, innerWidth),
  )

  const row = (content: string) =>
    `${chalk.blue('│')}${content}${' '.repeat(Math.max(0, innerWidth - content.length))}${chalk.blue('│')}`

  return [
    chalk.blue(`╭${border}╮`),
    row(title),
    row(meta),
    chalk.blue(`╰${border}╯`),
    '',
  ]
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map(block => {
      if (!block || typeof block !== 'object') {
        return ''
      }

      const typedBlock = block as Record<string, unknown>
      if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
        return typedBlock.text
      }

      if (
        typedBlock.type === 'tool_result' &&
        typeof typedBlock.content === 'string'
      ) {
        return typedBlock.content
      }

      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractToolUseLabels(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return []
  }

  return content
    .map(block => {
      if (!block || typeof block !== 'object') {
        return null
      }

      const typedBlock = block as Record<string, unknown>
      if (typedBlock.type !== 'tool_use') {
        return null
      }

      const name =
        typeof typedBlock.name === 'string' ? typedBlock.name : 'unknown_tool'
      return `调用工具 ${name}...`
    })
    .filter((value): value is string => value !== null)
}

function appendUnique(values: string[], nextValue: string): string[] {
  return values.includes(nextValue) ? values : [...values, nextValue]
}

function buildStreamingPlaceholderText(
  streamingAssistant: StreamingAssistantState,
): string {
  const sections: string[] = []

  if (streamingAssistant.pendingToolCalls.length > 0) {
    sections.push(
      ['正在请求工具', ...streamingAssistant.pendingToolCalls.map(label => `- ${label}`)].join('\n'),
    )
  }

  if (streamingAssistant.text.trim().length > 0) {
    sections.push(streamingAssistant.text)
  }

  if (sections.length === 0) {
    return '正在思考...'
  }

  return sections.join('\n\n')
}

function isToolResultUserMessage(message: Message): boolean {
  if (message.type !== 'user' || !Array.isArray(message.message?.content)) {
    return false
  }

  return message.message.content.some(block => {
    if (!block || typeof block !== 'object') {
      return false
    }

    return (block as Record<string, unknown>).type === 'tool_result'
  })
}

function extractToolResult(message: Message): {
  text: string
  phase: 'call' | 'done' | 'error'
} {
  if (!Array.isArray(message.message?.content)) {
    return { text: '', phase: 'done' }
  }

  const toolResult = message.message.content.find(block => {
    if (!block || typeof block !== 'object') {
      return false
    }

    return (block as Record<string, unknown>).type === 'tool_result'
  }) as
    | { content?: unknown; is_error?: boolean }
    | undefined

  const rawText =
    typeof toolResult?.content === 'string'
      ? toolResult.content
      : JSON.stringify(toolResult?.content ?? '')

  return {
    text: rawText
      .replace(/<tool_use_error>/g, '')
      .replace(/<\/tool_use_error>/g, ''),
    phase: toolResult?.is_error ? 'error' : 'done',
  }
}

function messageToViewport(message: Message, fallbackId: number): ViewportMessage | null {
  if (message.type === 'user') {
    if (isToolResultUserMessage(message)) {
      const { text, phase } = extractToolResult(message)
      return text
        ? {
            id: fallbackId,
            role: 'tool',
            text,
            toolPhase: phase,
          }
        : null
    }

    const text = extractTextContent(message.message?.content)
    return text
      ? {
          id: fallbackId,
          role: 'user',
          text,
        }
      : null
  }

  if (message.type === 'assistant') {
    const text = extractTextContent(message.message?.content)
    if (text) {
      return {
        id: fallbackId,
        role: 'assistant',
        text,
      }
    }

    const toolUseLabels = extractToolUseLabels(message.message?.content)
    return toolUseLabels.length > 0
      ? {
          id: fallbackId,
          role: 'tool',
          text: toolUseLabels.join('\n'),
          toolPhase: 'call',
        }
      : null
  }

  if (message.type === 'progress') {
    const data =
      message.data && typeof message.data === 'object'
        ? JSON.stringify(message.data)
        : String(message.data ?? 'working...')

    return {
      id: fallbackId,
      role: 'tool',
      text: data,
      toolPhase: 'call',
    }
  }

  if (message.type === 'system') {
    const text = extractTextContent(message.message?.content)
    return text
      ? {
          id: fallbackId,
          role: 'assistant',
          text,
        }
      : null
  }

  return null
}

export default function QueryApp() {
  const { exit } = useApp()
  const { columns, rows } = useWindowSize()
  const [input, setInput] = useState('')
  const [cursorSyncKey, setCursorSyncKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [alertMessage, setAlertMessage] = useState<string | null>(null)
  const [exitHint, setExitHint] = useState(false)
  const [streamingAssistant, setStreamingAssistant] = useState<StreamingAssistantState>({
    active: false,
    placeholderId: null,
    text: '',
    pendingToolCalls: [],
  })
  const [messages, rawSetMessages] = useState<Message[]>([])
  const [showCommandSelector, setShowCommandSelector] = useState(false)
  const [filteredCommands, setFilteredCommands] = useState(commands)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [appState, rawSetAppState] = useState<AppState>(() => ({
    ...getDefaultAppState(),
    mainLoopModel: getCurrentModel(),
  }))

  const messagesRef = useRef(messages)
  const appStateRef = useRef(appState)
  const abortControllerRef = useRef(new AbortController())
  const readFileStateRef = useRef(new FileStateCache(500, 50 * 1024 * 1024))
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextPlaceholderIdRef = useRef(1)
  const [animationTick, setAnimationTick] = useState(0)

  useEffect(() => {
    if (!loading) {
      setAnimationTick(0)
      return
    }

    const timer = setInterval(() => {
      setAnimationTick(prev => prev + 1)
    }, 50)

    return () => clearInterval(timer)
  }, [loading])

  const spinnerFrame =
    SPINNER_FRAMES[Math.floor(animationTick / 2) % SPINNER_FRAMES.length] ??
    SPINNER_FRAMES[0]
  const blinkVisible = Math.floor(animationTick / 6) % 2 === 0

  const setMessages = useCallback((updater: React.SetStateAction<Message[]>) => {
    rawSetMessages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      messagesRef.current = next
      return next
    })
  }, [])

  const setAppState = useCallback((updater: (prev: AppState) => AppState) => {
    rawSetAppState(prev => {
      const next = updater(prev)
      appStateRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    appStateRef.current = appState
  }, [appState])

  useEffect(() => {
    if (input.startsWith('/')) {
      const searchTerm = input.toLowerCase()
      const nextCommands = commands.filter(command =>
        command.label.toLowerCase().includes(searchTerm),
      )
      setFilteredCommands(nextCommands)
      setShowCommandSelector(nextCommands.length > 0)
      setSelectedCommandIndex(0)
      return
    }

    setShowCommandSelector(false)
    setSelectedCommandIndex(0)
  }, [input])

  const handleCommandSelect = useCallback((value: string) => {
    setInput(value)
    setCursorSyncKey(prev => prev + 1)
    setShowCommandSelector(false)
  }, [])

  const handleCtrlC = useCallback(() => {
    if (loading) {
      abortControllerRef.current.abort()
      return
    }

    if (exitHint) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current)
      }
      exit()
      return
    }

    setInput('')
    setExitHint(true)
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current)
    }

    exitTimerRef.current = setTimeout(() => {
      setExitHint(false)
      exitTimerRef.current = null
    }, 3000)
  }, [exit, exitHint, loading])

  useInput((_, key) => {
    if (!showCommandSelector) {
      return
    }

    if (key.upArrow) {
      setSelectedCommandIndex(index => Math.max(0, index - 1))
      return
    }

    if (key.downArrow) {
      setSelectedCommandIndex(index =>
        Math.min(filteredCommands.length - 1, index + 1),
      )
      return
    }

    if (key.return) {
      const selected = filteredCommands[selectedCommandIndex]
      if (selected) {
        handleCommandSelect(selected.value)
      }
    }
  }, { isActive: showCommandSelector })

  const buildToolUseContext = useCallback(
    (nextMessages: Message[], abortController: AbortController): ToolUseContext => ({
      options: {
        debug: false,
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mainLoopModel: getCurrentModel(),
        tools: getAllBaseTools(),
        isNonInteractiveSession: false,
      },
      readFileState: readFileStateRef.current,
      abortController,
      updateFileHistoryState: updater => {
        void updater
      },
      getAppState: () => appStateRef.current,
      setAppState,
      messages: nextMessages,
    }),
    [setAppState],
  )

  const handleQueryEvent = useCallback((event: Message | { type: string; [key: string]: unknown }) => {
    if (event.type === 'stream_event') {
      const streamEvent =
        event.event && typeof event.event === 'object'
          ? (event.event as Record<string, unknown>)
          : null

      if (!streamEvent || typeof streamEvent.type !== 'string') {
        return
      }

      if (streamEvent.type === 'message_start') {
        setStreamingAssistant(prev => ({
          active: true,
          placeholderId: prev.placeholderId,
          text: '',
          pendingToolCalls: [],
        }))
        return
      }

      if (streamEvent.type === 'content_block_start') {
        const contentBlock =
          streamEvent.content_block &&
          typeof streamEvent.content_block === 'object'
            ? (streamEvent.content_block as Record<string, unknown>)
            : null

        if (contentBlock?.type === 'text') {
          setStreamingAssistant(prev => ({
            ...prev,
            active: true,
          }))
        }

        if (contentBlock?.type === 'tool_use') {
          const toolName =
            typeof contentBlock.name === 'string'
              ? contentBlock.name
              : 'unknown_tool'
          const toolLabel = `调用工具 ${toolName}...`
          setStreamingAssistant(prev => ({
            ...prev,
            active: true,
            pendingToolCalls: appendUnique(prev.pendingToolCalls, toolLabel),
          }))
        }
        return
      }

      if (streamEvent.type === 'content_block_delta') {
        const delta =
          streamEvent.delta && typeof streamEvent.delta === 'object'
            ? (streamEvent.delta as Record<string, unknown>)
            : null

        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          setStreamingAssistant(prev => ({
            ...prev,
            active: true,
            text: prev.text + delta.text,
          }))
        }
        return
      }

      if (streamEvent.type === 'message_stop') {
        setStreamingAssistant(prev => ({
          ...prev,
          active: prev.text.length > 0 || prev.pendingToolCalls.length > 0,
        }))
        return
      }

      return
    }

    if (event.type === 'stream_request_start' || event.type === 'tool_use_summary') {
      return
    }

    if (event.type === 'tombstone') {
      const tombstone = event as Message
      const targetUuid =
        tombstone.message &&
        typeof tombstone.message === 'object' &&
        'uuid' in tombstone.message
          ? String((tombstone.message as Record<string, unknown>).uuid ?? '')
          : ''

      if (!targetUuid) {
        return
      }

      setMessages(prev =>
        prev.filter(message => String(message.uuid) !== targetUuid),
      )
      return
    }

    const message = event as Message
    if (message.type === 'assistant') {
      setStreamingAssistant({
        active: false,
        placeholderId: null,
        text: '',
        pendingToolCalls: [],
      })
    }
    setMessages(prev => [...prev, message])
  }, [setMessages])

  const onSubmit = useCallback(async (value: string) => {
    const text = value.trim()
    if (!text || loading) {
      return
    }

    setAlertMessage(null)

    const commandResult = await parseCommand(text)
    if (commandResult !== null) {
      if (!commandResult.success) {
        setAlertMessage(commandResult.message)
      } else {
        setMessages(prev => [
          ...prev,
          {
            type: 'assistant',
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
            message: {
              role: 'assistant',
              content: commandResult.message,
            },
          } as Message,
        ])
        setAppState(prev => ({ ...prev, mainLoopModel: getCurrentModel() }))
      }
      setInput('')
      return
    }

    const userMessage = createUserMessage({ content: text })
    const nextMessages = [...messagesRef.current, userMessage]
    setMessages(nextMessages)
    setInput('')
    setStreamingAssistant({
      active: false,
      placeholderId: nextPlaceholderIdRef.current++,
      text: '',
      pendingToolCalls: [],
    })
    setLoading(true)

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    try {
      for await (const event of query({
        messages: nextMessages,
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        userContext: {
          cwd: process.cwd(),
        },
        systemContext: {},
        toolUseContext: buildToolUseContext(nextMessages, abortController),
        querySource: 'repl_main_thread',
      })) {
        handleQueryEvent(event as Message)
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setAlertMessage('当前请求已取消')
      } else {
        setAlertMessage(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setLoading(false)
      setStreamingAssistant({
        active: false,
        placeholderId: null,
        text: '',
        pendingToolCalls: [],
      })
      setAppState(prev => ({ ...prev, mainLoopModel: getCurrentModel() }))
    }
  }, [buildToolUseContext, handleQueryEvent, loading, setAppState, setMessages])

  const terminalColumns = columns || process.stdout.columns || 80
  const terminalRows = rows || process.stdout.rows || 24
  const messageWidth = Math.max(8, terminalColumns - 4)
  const promptInputWidth = Math.max(8, terminalColumns - 6)
  const inputRule = '─'.repeat(Math.max(8, terminalColumns - 2))
  const fixedRows = INPUT_MARGIN_ROWS + INPUT_RULE_ROWS + FOOTER_ROWS
  const maxPromptInputRows = Math.max(
    1,
    Math.min(
      MAX_PROMPT_INPUT_ROWS,
      terminalRows - fixedRows - MIN_MESSAGE_VIEWPORT_ROWS,
    ),
  )
  const promptInputRows = Math.min(
    maxPromptInputRows,
    countWrappedRows(input, promptInputWidth),
  )
  const commandSelectorRows = showCommandSelector
    ? Math.min(COMMAND_SELECTOR_LIMIT, filteredCommands.length)
    : 0
  const messageViewportRows = Math.max(
    MIN_MESSAGE_VIEWPORT_ROWS,
    terminalRows - fixedRows - promptInputRows - commandSelectorRows,
  )

  const viewportMessages = messages
    .map((message, index) => messageToViewport(message, index + 1))
    .filter(Boolean) as ViewportMessage[]

  if (loading && streamingAssistant.placeholderId !== null) {
    if (streamingAssistant.text.trim().length > 0) {
      viewportMessages.push({
        id: streamingAssistant.placeholderId,
        role: 'assistant',
        text: buildStreamingPlaceholderText(streamingAssistant),
        animatePrefix: 'blink',
      })
    } else if (streamingAssistant.pendingToolCalls.length > 0) {
      viewportMessages.push({
        id: streamingAssistant.placeholderId,
        role: 'tool',
        text: streamingAssistant.pendingToolCalls.join('\n'),
        toolPhase: 'call',
        animatePrefix: 'blink',
      })
    }
  }

  const transcriptHeaderLines = getTranscriptHeaderLines({
    cwd: process.cwd(),
    model: getCurrentModel(),
    effort: getEffortLevel(),
    width: messageWidth,
  })

  const statusText = loading
    ? streamingAssistant.text.trim().length > 0
      ? 'Efrex 正在生成回复...'
      : streamingAssistant.pendingToolCalls.length > 0
        ? 'Efrex 正在请求工具...'
        : 'Efrex 正在思考...'
    : null

  const statusPrefix = statusText
    ? `${blinkVisible ? '•' : ' '} ${spinnerFrame}`
    : null

  const statusMessageWidth = statusText ? stringWidth(statusText) : 0
  const glimmerCycleLength = statusMessageWidth + GLIMMER_PAD_COLUMNS * 2
  const glimmerStep = glimmerCycleLength > 0 ? animationTick % glimmerCycleLength : 0
  const glimmerIndex = statusText
    ? streamingAssistant.pendingToolCalls.length > 0
      ? glimmerStep - GLIMMER_PAD_COLUMNS
      : statusMessageWidth + GLIMMER_PAD_COLUMNS - glimmerStep
    : 0
  const statusSegments = statusText
    ? getStatusLabelSegments(statusText, glimmerIndex)
    : null

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box flexDirection="column" flexShrink={0}>
        <MessageViewport
          headerLines={transcriptHeaderLines}
          messages={viewportMessages}
          width={messageWidth}
          height={messageViewportRows}
          nativeScrollback
          alertMessage={alertMessage}
          statusLine={null}
          blinkOn={blinkVisible}
        />
      </Box>

      {loading && statusText && statusPrefix && statusSegments ? (
        <Box marginTop={1} flexDirection="row" flexWrap="nowrap" flexShrink={0}>
          <Text color="yellowBright">{statusPrefix} </Text>
          <Text color="gray">{statusSegments.before}</Text>
          {statusSegments.shimmer ? (
            <Text color="cyanBright" bold>
              {statusSegments.shimmer}
            </Text>
          ) : null}
          <Text color="gray">{statusSegments.after}</Text>
        </Box>
      ) : null}

      <Box flexDirection="column" marginTop={1} flexShrink={0}>
        <Text color={loading ? 'blue' : 'gray'}>{inputRule}</Text>
        <Box>
          <Text color={loading ? 'blueBright' : 'greenBright'}>› </Text>
          <PromptInput
            value={input}
            width={promptInputWidth}
            maxVisibleLines={maxPromptInputRows}
            cursorSyncKey={cursorSyncKey}
            isActive
            suspendSubmit={showCommandSelector}
            suspendVerticalArrows={showCommandSelector}
            onChange={setInput}
            onSubmit={onSubmit}
            onCtrlC={handleCtrlC}
            onPasteText={text => text}
            placeholder={loading ? '等待 query.ts 响应中...' : ''}
          />
        </Box>
        <Text color={loading ? 'blue' : 'gray'}>{inputRule}</Text>

        {showCommandSelector && (
          <Box flexDirection="column">
            {filteredCommands.slice(0, commandSelectorRows).map((item, index) => (
              <Box key={item.value}>
                <Text color={index === selectedCommandIndex ? 'greenBright' : 'gray'}>
                  {index === selectedCommandIndex ? '› ' : '  '}
                </Text>
                <Text color={index === selectedCommandIndex ? 'greenBright' : undefined}>
                  {item.label}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column" flexShrink={0}>
        <Box>
          {exitHint ? (
            <Text dimColor>再按一次 Ctrl+C 确认退出</Text>
          ) : (
            <Text color="gray">Enter 发送 · 现在主界面直接走 query.ts · Ctrl+C 退出</Text>
          )}
        </Box>
      </Box>
    </Box>
  )
}

