import React, { useCallback, useEffect, useRef, useState } from 'react'
import chalk from 'chalk'
import { randomUUID } from 'node:crypto'
import { Box, Text, useApp, useInput, useWindowSize } from './ink.js'
import { stringWidth } from './ink/stringWidth.js'
import { buildEffectiveSystemPrompt } from './utils/systemPrompt.js'
import type { ScrollBoxHandle } from './ink/components/ScrollBox.js'
import PromptInput from './components/PromptInput.js'
import MessageViewport from './components/MessageViewport.js'
import { parseCommand } from './commands.js'
import type { Message as MessageType } from './package/message.js'
import { findToolByName, type Tool, type ToolUseContext } from './Tool.js'
import { getAllBaseTools } from './tools.js'
import { query } from './query.js'
import { handlePromptSubmit } from './utils/handlePromptSubmit.js'
import { getAnthropicModel, getEffortLevel } from './utils/anthropicConfig.js'
import { FileStateCache } from './utils/fileStateCache.js'
import { getSystemPrompt } from './constants/prompts.js'
import { getUserContext } from './context.js'
import { getDefaultAppState, type AppState } from './state/AppStateStore.js'
import { ThinkingConfig } from './queryEngine.js'
import { handleMessageFromStream } from './utils/handleMessageFromStream.js'
import { renderToolResultContent, renderToolUseContent } from './components/messages/renderToolContent.js'
import { APP_VERSION, CLI_APP_VERSION } from 'utils/load.js'
type ViewportMessage = {
  id: number
  role: 'user' | 'assistant' | 'tool'
  text: string
  content?: React.ReactNode
  toolPhase?: 'call' | 'done' | 'error'
  animatePrefix?: 'blink'
}

type ToolUseRenderItem = {
  text: string
  content: React.ReactNode
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
const APP_BRAND = 'efrex code'
const APP_VERSION = CLI_APP_VERSION

const commands = [
  { label: '/model                         Change Your Model', value: '/model' },
  { label: '/help                          Show help and available commands', value: '/help' },
]



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

function fitDisplay(text: string, width: number): string {
  if (stringWidth(text) <= width) {
    return text
  }

  let next = ''
  for (const char of Array.from(text)) {
    if (stringWidth(`${next}${char}…`) > width) {
      break
    }
    next += char
  }

  return `${next}…`
}

function padDisplay(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`
}

function centerDisplay(text: string, width: number): string {
  const textWidth = stringWidth(text)
  const leftPad = Math.max(0, Math.floor((width - textWidth) / 2))
  return `${' '.repeat(leftPad)}${text}${' '.repeat(Math.max(0, width - textWidth - leftPad))}`
}

function getTranscriptHeaderLines({
  cwd,
  model,
  effort,
  width,
  welcome,
}: {
  cwd: string
  model: string
  effort: string
  width: number
  welcome: boolean
}): string[] {
  const boxWidth = Math.max(12, width)
  const innerWidth = Math.max(1, boxWidth - 2)
  const meta = fitDisplay(`${cwd}  ·  model: ${model}  ·  effort: ${effort}`, innerWidth)
  const brand = `${chalk.cyanBright.bold('»')} ${chalk.cyanBright.bold(APP_BRAND)} ${chalk.gray(APP_VERSION)}`
  const brandPlain = `» ${APP_BRAND} ${APP_VERSION}`
  const rule = chalk.gray(` ${'─'.repeat(Math.max(0, boxWidth - stringWidth(brandPlain) - 2))}`)

  if (!welcome || boxWidth < 72) {
    return [
      `${brand}${rule}`,
      chalk.gray(fitDisplay(meta, boxWidth)),
      '',
    ]
  }

  const leftWidth = Math.max(28, Math.min(52, Math.floor(innerWidth * 0.42)))
  const rightWidth = Math.max(20, innerWidth - leftWidth - 1)
  const top = `${chalk.blue(`╭${'─'.repeat(leftWidth)}`)}${chalk.green(`┬${'─'.repeat(rightWidth)}╮`)}`
  const bottom = `${chalk.blue(`╰${'─'.repeat(leftWidth)}`)}${chalk.green(`┴${'─'.repeat(rightWidth)}╯`)}`
  const row = (
    leftPlain: string,
    leftStyled: string,
    rightPlain: string,
    rightStyled: string,
  ) =>
    `${chalk.blue('│')}${leftStyled}${' '.repeat(Math.max(0, leftWidth - stringWidth(leftPlain)))}${chalk.green('│')}${rightStyled}${' '.repeat(Math.max(0, rightWidth - stringWidth(rightPlain)))}${chalk.green('│')}`
  const left = (text: string, style: (value: string) => string = value => value) => {
    const plain = centerDisplay(fitDisplay(text, leftWidth), leftWidth)
    return { plain, styled: style(plain) }
  }
  const right = (text: string, style: (value: string) => string = value => value) => {
    const plain = padDisplay(fitDisplay(text, rightWidth), rightWidth)
    return { plain, styled: style(plain) }
  }
  const makeRow = (
    leftText: string,
    rightText: string,
    leftStyle: (value: string) => string = value => value,
    rightStyle: (value: string) => string = value => value,
  ) => {
    const leftCell = left(leftText, leftStyle)
    const rightCell = right(rightText, rightStyle)
    return row(leftCell.plain, leftCell.styled, rightCell.plain, rightCell.styled)
  }
  const makeLeftInfoRow = (leftText: string, rightText: string) => {
    const leftPlain = padDisplay(`  ${fitDisplay(leftText, Math.max(1, leftWidth - 4))}`, leftWidth)
    const rightCell = right(rightText, value => chalk.gray(value))
    return row(leftPlain, chalk.gray(leftPlain), rightCell.plain, rightCell.styled)
  }

  return [
    `${brand}${rule}`,
    top,
    makeRow('efrex code', '✦  Getting Started', value => chalk.hex('#8f7cff').bold(value), value => chalk.greenBright.bold(value)),
    makeRow('AI Coding Assistant', 'Ask anything, edit code, run commands.', value => chalk.gray(value), value => chalk.gray(value)),
    makeRow('Power your ideas with code.', 'Let efrex code handle the rest.', value => chalk.gray(value), value => chalk.gray(value)),
    makeRow('     ╭──────╮', 'Tips', value => chalk.blueBright(value), value => chalk.yellowBright.bold(`${value}`)),
    makeRow('     │ •  • │', '────────────────────────────────────────', value => chalk.blueBright(value), value => chalk.green(value)),
    makeRow('     │  ──  │', '', value => chalk.blueBright(value)),
    makeRow('     ╰─┬──┬─╯', '→  Ask questions about your codebase', value => chalk.blueBright(value), value => chalk.gray(value.replace('→', chalk.yellowBright('→')))),
    makeRow('      ╰──╯', '', value => chalk.blueBright(value)),
    makeRow(`model: ${model} | effort: ${effort} `, '→  Generate or refactor code', value => chalk.gray(value), value => chalk.gray(value.replace('→', chalk.yellowBright('→')))),
    makeRow(`${cwd}`, '→  Run shell commands and analyze results', value => value, value => chalk.gray(value.replace('→', chalk.yellowBright('→')))),
    // makeRow('Type /help to see available commands', '→  Use natural language to automate tasks', value => chalk.gray(value.replace('/help', chalk.cyanBright('/help'))), value => chalk.gray(value.replace('→', chalk.yellowBright('→')))),
    bottom,
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

function renderNodeToPlainText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(child => renderNodeToPlainText(child)).join('')
  }

  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return renderNodeToPlainText(props.children)
  }

  return ''
}

function getToolResultBlock(message: MessageType): {
  toolUseId: string
  isError: boolean
} | null {
  if (!Array.isArray(message.message?.content)) {
    return null
  }

  const block = message.message.content.find((contentBlock: unknown) => {
    if (!contentBlock || typeof contentBlock !== 'object') {
      return false
    }

    return (contentBlock as Record<string, unknown>).type === 'tool_result'
  }) as { tool_use_id?: unknown; is_error?: unknown } | undefined

  if (!block || typeof block.tool_use_id !== 'string') {
    return null
  }

  return {
    toolUseId: block.tool_use_id,
    isError: Boolean(block.is_error),
  }
}

function findAssistantToolUse(
  messages: MessageType[],
  message: MessageType,
  toolUseId: string,
): { name: string; input: unknown } | null {
  const sourceAssistantUUID =
    typeof message.sourceToolAssistantUUID === 'string'
      ? message.sourceToolAssistantUUID
      : null

  const candidateMessages = sourceAssistantUUID
    ? messages.filter(candidate => String(candidate.uuid) === sourceAssistantUUID)
    : messages

  for (const candidate of candidateMessages) {
    if (!Array.isArray(candidate.message?.content)) {
      continue
    }

    const toolUse = candidate.message.content.find((block: unknown) => {
      if (!block || typeof block !== 'object') {
        return false
      }

      const typedBlock = block as Record<string, unknown>
      return typedBlock.type === 'tool_use' && typedBlock.id === toolUseId
    }) as { name?: unknown; input?: unknown } | undefined

    if (toolUse && typeof toolUse.name === 'string') {
      return {
        name: toolUse.name,
        input: toolUse.input,
      }
    }
  }

  return null
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

function isToolResultUserMessage(message: MessageType): boolean {
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

function extractToolResult(message: MessageType): {
  text: string
  phase: 'call' | 'done' | 'error'
} {
  if (!Array.isArray(message.message?.content)) {
    return { text: '', phase: 'done' }
  }

  const toolResult = message.message.content.find((block: unknown) => {
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

function messageToViewport(
  message: MessageType,
  fallbackId: number,
  messages: MessageType[],
  tools: readonly Tool[],
): ViewportMessage | null {
  if (message.type === 'user') {
    if (isToolResultUserMessage(message)) {
      const toolResultBlock = getToolResultBlock(message)
      if (toolResultBlock && !toolResultBlock.isError) {
        const toolUse = findAssistantToolUse(
          messages,
          message,
          toolResultBlock.toolUseId,
        )
        const tool = toolUse ? findToolByName(tools, toolUse.name) : undefined
        const renderedContent = renderToolResultContent(
          tool,
          message.toolUseResult,
          toolUse?.input,
          tools,
        )

        if (renderedContent) {
          return {
            id: fallbackId,
            role: 'tool',
            text: renderNodeToPlainText(renderedContent),
            content: renderedContent,
            toolPhase: 'done',
          }
        }
      }

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

    const toolUseItems: ToolUseRenderItem[] = Array.isArray(message.message?.content)
      ? message.message.content
          .map((block): ToolUseRenderItem | null => {
            if (!block || typeof block !== 'object') {
              return null
            }

            const typedBlock = block as Record<string, unknown>
            if (typedBlock.type !== 'tool_use') {
              return null
            }

            const toolName =
              typeof typedBlock.name === 'string'
                ? typedBlock.name
                : 'unknown_tool'
            const tool = findToolByName(tools, toolName)
            const content = renderToolUseContent(tool, typedBlock.input)
            const text =
              content === null
                ? `调用工具 ${toolName}...`
                : renderNodeToPlainText(content)
            return {
              text: text.trim() || `调用工具 ${toolName}...`,
              content: content ?? <Text>{`调用工具 ${toolName}...`}</Text>,
            }
          })
          .filter((value): value is ToolUseRenderItem => value !== null)
      : extractToolUseLabels(message.message?.content).map(label => ({
          text: label,
          content: <Text>{label}</Text>,
        }))

    return toolUseItems.length > 0
      ? {
          id: fallbackId,
          role: 'tool',
          text: toolUseItems.map(item => item.text).join('\n'),
          content: (
            <Box flexDirection="column">
              {toolUseItems.map((item, index) => (
                <Box key={index} flexDirection="column">
                  {item.content}
                </Box>
              ))}
            </Box>
          ),
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
export type Props = {
  debug: boolean;
  initialTools: Tool[];
  // Initial messages to populate the REPL with
  initialMessages?: MessageType[];
  // Content-replacement records from a resumed session's transcript — used to
  // Initial agent context for session resume (name/color set via /rename or /color)
  initialAgentName?: string;
  autoConnectIdeFlag?: boolean;
  strictMcpConfig?: boolean;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  // Optional callback invoked before query execution
  // Called after user message is added to conversation but before API call
  // Return false to prevent query execution
  onBeforeQuery?: (input: string, newMessages: MessageType[]) => Promise<boolean>;
  // Optional callback when a turn completes (model finishes responding)
  onTurnComplete?: (messages: MessageType[]) => void | Promise<void>;
  // When true, disables REPL input (hides prompt and prevents message selector)
  disabled?: boolean;
  // When true, disables all slash commands
  disableSlashCommands?: boolean;
  // Task list id: when set, enables tasks mode that watches a task list and auto-processes tasks.
  taskListId?: string;
  thinkingConfig: ThinkingConfig;
};
export default function QueryApp(
  {
  debug,
  initialMessages,
  initialTools,
  strictMcpConfig = false,
  systemPrompt: customSystemPrompt,
  appendSystemPrompt,
  onBeforeQuery,
  onTurnComplete,
  disabled = false,
  disableSlashCommands = false,
  taskListId,
  thinkingConfig
}: Props
) {
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
  const [messages, rawSetMessages] = useState<MessageType[]>([])
  const [showCommandSelector, setShowCommandSelector] = useState(false)
  const [filteredCommands, setFilteredCommands] = useState(commands)
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [appState, rawSetAppState] = useState<AppState>(() => ({
    ...getDefaultAppState(),
    mainLoopModel: getCurrentModel(),
  }))

  const messagesRef = useRef(messages)
  const appStateRef = useRef(appState)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  // 始终指向当前中止控制器的 Ref，用于在异步回调中读取最新 controller。
  const abortControllerRef = useRef<AbortController | null>(null)
  abortControllerRef.current = abortController
  const readFileStateRef = useRef(new FileStateCache(500, 50 * 1024 * 1024))
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nextPlaceholderIdRef = useRef(1)
  const scrollRef = useRef<ScrollBoxHandle | null>(null)
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

  const blinkVisible = Math.floor(animationTick / 6) % 2 === 0

  const setMessages = useCallback((updater: React.SetStateAction<MessageType[]>) => {
    const next =
      typeof updater === 'function' ? updater(messagesRef.current) : updater
    messagesRef.current = next
    rawSetMessages(next)
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
      abortControllerRef.current?.abort('user-cancel')
      setAbortController(null)
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

  const repinScroll = useCallback(() => {
    scrollRef.current?.scrollToBottom()
  }, [])

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
    (nextMessages: MessageType[], abortController: AbortController): ToolUseContext => ({
      options: {
        debug: false,
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mainLoopModel: getCurrentModel(),
        tools: getAllBaseTools(),
        isNonInteractiveSession: false,
        customSystemPrompt,
        appendSystemPrompt
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

  const onQueryEvent = useCallback((event: MessageType | { type: string; [key: string]: unknown }) => {
    handleMessageFromStream(event, {
      onMessageStart: () => {
        setStreamingAssistant(prev => ({
          active: true,
          placeholderId: prev.placeholderId,
          text: '',
          pendingToolCalls: [],
        }))
      },
      onTextBlockStart: () => {
        setStreamingAssistant(prev => ({
          ...prev,
          active: true,
        }))
      },
      onToolUseBlockStart: toolName => {
        const toolLabel = `调用工具 ${toolName}...`
        setStreamingAssistant(prev => ({
          ...prev,
          active: true,
          pendingToolCalls: appendUnique(prev.pendingToolCalls, toolLabel),
        }))
      },
      onTextDelta: text => {
        setStreamingAssistant(prev => ({
          ...prev,
          active: true,
          text: prev.text + text,
        }))
      },
      onMessageStop: () => {
        setStreamingAssistant(prev => ({
          ...prev,
          active: prev.text.length > 0 || prev.pendingToolCalls.length > 0,
        }))
      },
      onTombstone: tombstone => {
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
      },
      onMessage: message => {
        if (message.type === 'assistant') {
          setStreamingAssistant({
            active: false,
            placeholderId: null,
            text: '',
            pendingToolCalls: [],
          })
        }
        setMessages(prev => [...prev, message])
      },
    })
  }, [setMessages])

  const onQueryImpl = useCallback(async (
    messagesIncludingNewMessages: MessageType[],
    _newMessages: MessageType[],
    abortController: AbortController,
    shouldQuery: boolean,
    _additionalAllowedTools: string[],
    mainLoopModelParam: string,
  ): Promise<void> => {
    if (!shouldQuery) {
      return
    }
    const toolUseContext =  buildToolUseContext(messagesIncludingNewMessages, abortController)
    const {
      tools: freshTools,
    } = toolUseContext.options;
    const [defaultSystemPrompt, baseUserContext] = await Promise.all([
    getSystemPrompt(freshTools, mainLoopModelParam, 
      ["F:\\pythonProject"]), getUserContext()]);//, getSystemContext()] systemContext
    const userContext = {
      ...baseUserContext}
    const systemPrompt = buildEffectiveSystemPrompt({
      toolUseContext,
      customSystemPrompt,
      defaultSystemPrompt,
      appendSystemPrompt
    });
    
    try {
      for await (const event of query({
        messages: messagesIncludingNewMessages,
        systemPrompt: systemPrompt,
        userContext: userContext,
        systemContext: {},
        toolUseContext:toolUseContext,
        querySource: 'repl_main_thread',
      })) {
        onQueryEvent(event as MessageType)
      }
    
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setAlertMessage('当前请求已取消')
      } else {
        setAlertMessage(error instanceof Error ? error.message : String(error))
      }
    }
  }, [buildToolUseContext, onQueryEvent])

  const onQuery = useCallback(async (
    newMessages: MessageType[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModelParam: string,
  ): Promise<void> => {
    
    setMessages(oldMessages => [...oldMessages, ...newMessages]);
    setInput('')
    setStreamingAssistant({
      active: false,
      placeholderId: nextPlaceholderIdRef.current++,
      text: '',
      pendingToolCalls: [],
    })
    setLoading(true)

    try {
      const latestMessages = messagesRef.current
      await onQueryImpl(
        latestMessages,
        newMessages,
        abortController,
        shouldQuery,
        additionalAllowedTools,
        mainLoopModelParam,
      )
    } finally {
      setLoading(false)
      if (shouldQuery) {
        setStreamingAssistant({
          active: false,
          placeholderId: null,
          text: '',
          pendingToolCalls: [],
        })
        setAppState(prev => ({ ...prev, mainLoopModel: getCurrentModel() }))
      }
    }
  }, [onQueryImpl, setAppState, setMessages])

  const submitPrompt = useCallback(async (text: string) => {
    await handlePromptSubmit({
      text,
      setAbortController,
      getCurrentModel,
      onQuery,
    })
  }, [getCurrentModel, onQuery])

  const onSubmit = useCallback(async (value: string) => {
    const text = value.trim()
    if (!text || loading) {
      return
    }

    repinScroll()//滚回底部
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
          } as MessageType,
        ])
        setAppState(prev => ({ ...prev, mainLoopModel: getCurrentModel() }))
      }
      setInput('')
      return
    }

    await submitPrompt(text)
  }, [loading, repinScroll, setAppState, setMessages, submitPrompt])

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

  const renderTools = initialTools.length > 0 ? initialTools : getAllBaseTools()
  const viewportMessages = messages
    .map((message, index) =>
      messageToViewport(message, index + 1, messages, renderTools),
    )
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
    welcome: messages.length === 0 && !loading,
  })

  const statusText = loading
    ? streamingAssistant.text.trim().length > 0
      ? 'Efrex 正在生成回复...'
      : streamingAssistant.pendingToolCalls.length > 0
        ? 'Efrex 正在请求工具...'
        : 'Efrex 正在思考...'
    : null
  const statusMode = loading
    ? streamingAssistant.pendingToolCalls.length > 0
      ? 'requesting'
      : 'default'
    : null

  const statusPrefix = statusText ? (blinkVisible ? '•' : ' ') : null

  const statusMessageWidth = statusText ? stringWidth(statusText) : 0
  const glimmerSpeed = statusMode === 'requesting' ? 50 : 200
  const elapsedMs = animationTick * 50
  const glimmerCycleLength = statusMessageWidth + GLIMMER_PAD_COLUMNS * 2
  const cyclePosition =
    glimmerCycleLength > 0 ? Math.floor(elapsedMs / glimmerSpeed) : 0
  const glimmerIndex = statusText
    ? (cyclePosition % glimmerCycleLength) - GLIMMER_PAD_COLUMNS
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
          scrollBoxRef={scrollRef}
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
