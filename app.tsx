import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useWindowSize} from './src/ink.js';
import chalk from 'chalk';
import {askOpenAI, type ToolExecutionMessage, type UserMessageContent} from './src/queryDemo.js';
import {randomUUID} from 'crypto';
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {readHistoryJSONL, saveSessionHistory, SessionHistory} from './utils/load.js';
import PromptInput from './src/components/PromptInput.js';
import MessageViewport from './src/components/MessageViewport.js';
import {parseCommand} from './src/commands.js';
import {stringWidth} from './src/ink/stringWidth.js';
import {formatPastedTextLabel} from './src/hooks/format.js';
import {readImageWithTokenBudget} from './src/tools/FileReadTool/FileReadTool.js';
import {createImageDataURL, type ImageMediaType} from './src/utils/imageResizer.js';
import {getAnthropicModel, getEffortLevel} from './src/utils/anthropicConfig.js';
type Message = {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  timestamp: Date;
  toolPhase?: ToolExecutionMessage['phase'];
};

type PastedContentEntry =
  | {id: number; type: 'text'; content: string}
  | {id: number; type: 'image'; sourcePath: string; mediaType?: string};

const MASCOT = ['  /\\_/\\\\', ' ( o.o )', '  > ^ <'];
const INPUT_MARGIN_ROWS = 1;
const INPUT_RULE_ROWS = 2;
const FOOTER_ROWS = 2;
const MIN_MESSAGE_VIEWPORT_ROWS = 1;
const MAX_PROMPT_INPUT_ROWS = 6;
const COMMAND_SELECTOR_LIMIT = 5;

function getCurrentModel(): string {
  return getAnthropicModel();
}

const commands = [
  {label: '/model                         Change Your Model', value: '/model'},
  {label: '/init                         Initialize a new CLAUDE.md file with codebase documentation', value: '/init'},
  {label: '/add-dir                      Add a new working directory', value: '/add-dir'},
  {label: '/agents                       Manage agent configurations', value: '/agents'},
  {label: '/branch                       Create a branch of the current conversation at this point', value: '/branch'},
  {label: '/btw                          Ask a quick side question without interrupting the main conversation', value: '/btw'},
  {label: '/clear                        Start a new session with empty context', value: '/clear'},
  {label: '/color                        Set the prompt bar color for this session', value: '/color'},
  {label: '/compact                      Free up context by summarizing the conversation so far', value: '/compact'},
  {label: '/config                       Open config panel', value: '/config'},
  {label: '/context                      Visualize current context usage as a colored grid', value: '/context'},
  {label: '/copy                         Copy Claude\'s last response to clipboard (or /copy N for the Nth-latest)', value: '/copy'},
  {label: '/cost                         Show the total cost and duration of the current session', value: '/cost'},
  {label: '/diff                         View uncommitted changes and per-turn diffs', value: '/diff'},
  {label: '/doctor                       Diagnose and verify your Claude Code installation and settings', value: '/doctor'},
  {label: '/effort                       Set effort level for model usage', value: '/effort'},
  {label: '/exit                         Exit the CLI', value: '/exit'},
  {label: '/export                       Export the current conversation to a file or clipboard', value: '/export'},
  {label: '/fast                         Toggle fast mode (Opus 4.6 only)', value: '/fast'},
  {label: '/feedback                     Submit feedback about Claude Code', value: '/feedback'},
  {label: '/help                         Show help and available commands', value: '/help'},
  {label: '/hooks                        View hook configurations for tool events', value: '/hooks'},
  {label: '/ide                          Manage IDE integrations and show status', value: '/ide'},
  {label: '/keybindings                  Open or create your keybindings configuration file', value: '/keybindings'},
];

function resolvePastedPlaceholders(text: string, pastedMap: Map<number, PastedContentEntry>) {
  const usedIds = new Set<number>();
  const resolvedText = text.replace(/\[(?:Pasted text|Pasted) #(\d+)(?: \+\d+ lines| \d+ lines| \d+ characters)?\]/g, (match, idText) => {
    const id = Number(idText);
    const pastedContent = pastedMap.get(id);
    if (pastedContent?.type !== 'text') {
      return match;
    }
    usedIds.add(id);
    return pastedContent.content;
  });

  return {resolvedText, usedIds};
}
function toPastedContentsRecord(pastedMap: Map<number, PastedContentEntry>, usedIds: Set<number>) {
  return Object.fromEntries(
    Array.from(usedIds).flatMap(id => {
      const content = pastedMap.get(id);
      if (content === undefined) {
        return [];
      }

      return [[
      String(id),
      content,
      ]];
    }),
  );
}

function arePastedContentsEqual(
  left: SessionHistory['pastedContents'],
  right: SessionHistory['pastedContents'],
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key, index) => {
    if (key !== rightKeys[index]) {
      return false;
    }

    const leftValue = left[key];
    const rightValue = right[key];

    return (
      leftValue?.id === rightValue?.id &&
      leftValue?.type === rightValue?.type &&
      leftValue?.content === rightValue?.content
    );
  });
}

function isSameHistoryEntry(left: SessionHistory | undefined, right: SessionHistory): boolean {
  if (!left) {
    return false;
  }

  return (
    left.display === right.display &&
    left.project === right.project &&
    arePastedContentsEqual(left.pastedContents, right.pastedContents)
  );
}

function shouldUsePastedPlaceholder(text: string): boolean {
  if (text.length >= 2000) {
    return true;
  }

  const normalizedText = normalizeLineEndings(text);
  const textWithoutTrailingNewlines = normalizedText.replace(/\n+$/, '');
  if (!textWithoutTrailingNewlines) {
    return false;
  }

  const lineCount = textWithoutTrailingNewlines.split('\n').length;
  return lineCount > 3;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function formatImageLabel(index: number): string {
  return `[Image #${index}]`;
}

function normalizePastedPath(text: string): string | null {
  const trimmed = normalizeLineEndings(text).trim();
  if (!trimmed || trimmed.includes('\n')) {
    return null;
  }

  return trimmed.replace(/^["']|["']$/g, '');
}

function isImagePath(text: string): boolean {
  const filePath = normalizePastedPath(text);
  if (!filePath) {
    return false;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    return false;
  }

  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveImagePlaceholders(text: string, pastedMap: Map<number, PastedContentEntry>) {
  const usedIds = new Set<number>();
  const imageRefs: PastedContentEntry[] = [];
  const textWithRefs = text.replace(/\[Image #(\d+)\]/g, (match, idText) => {
    const id = Number(idText);
    const pastedContent = pastedMap.get(id);
    if (pastedContent?.type !== 'image') {
      return match;
    }
    usedIds.add(id);
    imageRefs.push(pastedContent);
    return '';
  });

  return {
    text: textWithRefs.replace(/[ \t]+\n/g, '\n').trim(),
    usedIds,
    imageRefs,
  };
}

async function createUserContentWithImages(
  text: string,
  imageRefs: PastedContentEntry[],
): Promise<UserMessageContent> {
  if (imageRefs.length === 0) {
    return text;
  }

  const content: Exclude<UserMessageContent, string> = [];
  if (text.length > 0) {
    content.push({type: 'text', text});
  }

  for (const imageRef of imageRefs) {
    if (imageRef.type !== 'image') {
      continue;
    }
    const image = await readImageWithTokenBudget(imageRef.sourcePath);
    content.push({
      type: 'image_url',
      image_url: {
        url: createImageDataURL(
          image.file.type as ImageMediaType,
          image.file.base64,
        ),
      },
    });
  }

  return content;
}

function countWrappedRows(text: string, width: number): number {
  if (text.length === 0) {
    return 1;
  }

  const safeWidth = Math.max(1, width);
  return normalizeLineEndings(text)
    .split('\n')
    .reduce((rows, logicalLine) => {
      if (logicalLine.length === 0) {
        return rows + 1;
      }

      let lineWidth = 0;
      let visualRows = 1;
      for (const char of Array.from(logicalLine)) {
        const charWidth = stringWidth(char);
        if (lineWidth > 0 && lineWidth + charWidth > safeWidth) {
          visualRows++;
          lineWidth = charWidth;
        } else {
          lineWidth += charWidth;
        }
      }

      return rows + visualRows;
    }, 0);
}

function truncateDisplay(text: string, width: number): string {
  if (stringWidth(text) <= width) {
    return text;
  }

  let output = '';
  for (const char of Array.from(text)) {
    if (stringWidth(output + char) > width - 1) {
      break;
    }
    output += char;
  }
  return `${output}…`;
}

function getTranscriptHeaderLines({
  cwd,
  model,
  effort,
  width,
}: {
  cwd: string;
  model: string;
  effort: string;
  width: number;
}): string[] {
  const boxWidth = Math.max(12, width);
  const innerWidth = Math.max(1, boxWidth - 2);
  const border = '─'.repeat(innerWidth);
  const title = `${chalk.blueBright.bold('Efrex')} ${chalk.gray('terminal assistant')}`;
  const metaWidth = Math.max(1, innerWidth - stringWidth(MASCOT[1] ?? '') - 1);
  const meta = chalk.gray(truncateDisplay(`${cwd}  ·  model: ${model}  ·  effort: ${effort}`, metaWidth));

  const row = (left: string, right = '') => {
    const gap = Math.max(1, innerWidth - stringWidth(left) - stringWidth(right));
    const content = `${left}${' '.repeat(gap)}${right}`;
    return `${chalk.blue('│')}${content}${' '.repeat(Math.max(0, innerWidth - stringWidth(content)))}${chalk.blue('│')}`;
  };

  return [
    chalk.blue(`╭${border}╮`),
    row(title, chalk.cyanBright(MASCOT[0] ?? '')),
    row(meta, chalk.cyanBright(MASCOT[1] ?? '')),
    row('', chalk.cyanBright(MASCOT[2] ?? '')),
    chalk.blue(`╰${border}╯`),
    '',
  ];
}

export default function App() {
  const {exit} = useApp();
  const {columns, rows} = useWindowSize();
  const [input, setInput] = useState('');
  const [cursorSyncKey, setCursorSyncKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isReasoning, setIsReasoning] = useState(false);
  const [reasoningDuration, setReasoningDuration] = useState<number | null>(null);
  const [retryInfo, setRetryInfo] = useState<{attempt: number; max: number} | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [exitHint, setExitHint] = useState(false);
  const [pastedContents,setPasteContents]=useState(new Map<number,PastedContentEntry>())
  const pastedContentsRef = useRef(new Map<number, PastedContentEntry>());
  const pasteCountRef = useRef(0);
  const toolMessageIdRef = useRef(0);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController>(new AbortController());
  const [historyList, setHistoryList] = useState<SessionHistory[]>([]);
  const historyListRef = useRef<SessionHistory[]>([]);
  const [committedMessages, setCommittedMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const [activeToolMessages, setActiveToolMessages] = useState<Message[]>([]);
  const activeToolMessagesRef = useRef<Message[]>([]);
  const streamingMessageRef = useRef<Message | null>(null);
  const [showCommandSelector, setShowCommandSelector] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState(commands);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [modelRefreshKey, setModelRefreshKey] = useState(0);
  const cwd: string = process.cwd();
  const model = getCurrentModel();
  const effort = getEffortLevel();
  const terminalColumns = columns || process.stdout.columns || 80;
  const inputRule = '─'.repeat(Math.max(8, terminalColumns - 2));
  const messageWidth = Math.max(8, terminalColumns - 4);
  const terminalRows = rows || process.stdout.rows || 24;
  const promptInputWidth = Math.max(8, terminalColumns - 6);
  const fixedRows =
    INPUT_MARGIN_ROWS +
    INPUT_RULE_ROWS +
    FOOTER_ROWS;
  const maxPromptInputRows = Math.max(
    1,
    Math.min(
      MAX_PROMPT_INPUT_ROWS,
      terminalRows - fixedRows - MIN_MESSAGE_VIEWPORT_ROWS,
    ),
  );
  const promptInputRows = Math.min(
    maxPromptInputRows,
    countWrappedRows(input, promptInputWidth),
  );
  const maxCommandSelectorRows = Math.max(
    0,
    Math.min(
      COMMAND_SELECTOR_LIMIT,
      terminalRows - fixedRows - promptInputRows - MIN_MESSAGE_VIEWPORT_ROWS,
    ),
  );
  const commandSelectorRows = showCommandSelector
    ? Math.min(COMMAND_SELECTOR_LIMIT, filteredCommands.length, maxCommandSelectorRows)
    : 0;
  const commandSelectorVisible = showCommandSelector && commandSelectorRows > 0;
  const messageViewportRows = Math.max(
    MIN_MESSAGE_VIEWPORT_ROWS,
    terminalRows - fixedRows - promptInputRows - commandSelectorRows,
  );
  const viewportMessages = [
    ...committedMessages,
    ...activeToolMessages,
    ...(streamingMessage ? [streamingMessage] : []),
  ];
  const transcriptHeaderLines = getTranscriptHeaderLines({
    cwd,
    model,
    effort,
    width: messageWidth,
  });
  const activityStatusLine = retryInfo
    ? `⟳ 正在连接重试 ${retryInfo.attempt}/${retryInfo.max}...`
    : loading && isReasoning
      ? `Efrex 正在思考... (${Math.floor((reasoningDuration ?? 0) / 1000)}s)`
      : null;
  const statusLine = activityStatusLine;

  // 过滤命令
  useEffect(() => {
    if (input.startsWith('/')) {
      const searchTerm = input.toLowerCase();
      const filtered = commands.filter(cmd =>
        cmd.label.toLowerCase().includes(searchTerm)
      );
      setFilteredCommands(filtered);
      setShowCommandSelector(filtered.length > 0);
      setSelectedCommandIndex(0);
    } else {
      setShowCommandSelector(false);
      setSelectedCommandIndex(0);
    }
  }, [input]);

  // 处理命令选择
  const handleCommandSelect = (item: {value: string}) => {
    setInput(item.value);
    setCursorSyncKey(prev => prev + 1);
    setShowCommandSelector(false);
  };

  const handlePasteText = useCallback((text: string): string => {
    const normalizedText = normalizeLineEndings(text);
    const imagePath = normalizePastedPath(normalizedText);
    if (imagePath && isImagePath(imagePath)) {
      const id = pasteCountRef.current + 1;
      pasteCountRef.current = id;
      const next = new Map(pastedContentsRef.current);
      next.set(id, {
        id,
        type: 'image',
        sourcePath: imagePath,
      });
      pastedContentsRef.current = next;
      setPasteContents(next);
      return formatImageLabel(id);
    }

    if (!shouldUsePastedPlaceholder(normalizedText)) {
      return normalizedText;
    }

    const id = pasteCountRef.current + 1;
    pasteCountRef.current = id;
    const next = new Map(pastedContentsRef.current);
    next.set(id, {
      id,
      type: 'text',
      content: normalizedText,
    });
    pastedContentsRef.current = next;
    setPasteContents(next);
    return formatPastedTextLabel(id, normalizedText);
  }, []);

  useInput((_, key) => {
    if (!commandSelectorVisible) {
      return;
    }

    if (key.upArrow) {
      setSelectedCommandIndex(index => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedCommandIndex(index =>
        Math.min(commandSelectorRows - 1, index + 1),
      );
      return;
    }

    if (key.return) {
      const selected = filteredCommands[selectedCommandIndex];
      if (selected) {
        handleCommandSelect(selected);
      }
    }
  }, {isActive: commandSelectorVisible});

  const handleCtrlC = useCallback(() => {
    if (loading) {
      controllerRef.current.abort();
      setLoading(false);
      return;
    }

    if (exitHint) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
      }
      exit();
      return;
    }

    setInput('');
    setExitHint(true);
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
    }

    exitTimerRef.current = setTimeout(() => {
      setExitHint(false);
      exitTimerRef.current = null;
    }, 3000);
  }, [exit, exitHint, loading]);

  const appendHistoryEntry = useCallback((newHistory: SessionHistory) => {
    const previousHistory = historyListRef.current;
    const lastHistory = previousHistory[previousHistory.length - 1];

    if (isSameHistoryEntry(lastHistory, newHistory)) {
      return;
    }

    const nextHistory = [...previousHistory, newHistory];
    historyListRef.current = nextHistory;
    setHistoryList(nextHistory);
    void saveSessionHistory(newHistory);
  }, []);

  const onSubmit = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text || loading) return;
      setAlertMessage(null);

      // 处理命令
      const commandResult = await parseCommand(text);
      if (commandResult !== null) {
        if (!commandResult.success) {
          setAlertMessage(commandResult.message);
        } else {
          // 显示成功消息作为系统消息
          const systemMsg: Message = {
            id: Date.now(),
            role: 'assistant',
            text: commandResult.message,
            timestamp: new Date(),
          };
          setCommittedMessages(prev => [...prev, systemMsg]);
          // 如果是模型切换命令，刷新 Header 显示
          if (text.toLowerCase().startsWith('/model')) {
            setModelRefreshKey(prev => prev + 1);
          }
        }
        setInput('');
        return;
      }

      const {resolvedText, usedIds: usedTextIds} = resolvePastedPlaceholders(text, pastedContentsRef.current);
      const {
        text: textWithoutImageRefs,
        usedIds: usedImageIds,
        imageRefs,
      } = resolveImagePlaceholders(resolvedText, pastedContentsRef.current);
      const usedIds = new Set([...usedTextIds, ...usedImageIds]);
      const userContent = await createUserContentWithImages(
        textWithoutImageRefs || resolvedText,
        imageRefs,
      );
      // 每次请求创建新的 AbortController
      controllerRef.current = new AbortController();
      const sessionId = randomUUID();
      const userMsg: Message = {
        id: Date.now(),
        role: 'user',
        text: text,
        timestamp: new Date(),
      };
      const newHistory: SessionHistory = {
        display: text,
        pastedContents: toPastedContentsRecord(pastedContentsRef.current, usedIds),
        timestamp: Date.now(),
        project: cwd,
        sessionId: sessionId,
      };
      appendHistoryEntry(newHistory);
      setCommittedMessages(prev => [...prev, userMsg]);
      setInput('');
      activeToolMessagesRef.current = [];
      setActiveToolMessages([]);
      const streamingMsgId = Date.now() + 1;
      setStreamingMessage({
        id: streamingMsgId,
        role: 'assistant',
        text: '',
        timestamp: new Date(),
      });
      try {
        setLoading(true);
        setIsReasoning(false);
        setReasoningDuration(null);
        const result = await askOpenAI(
          userContent,
          controllerRef.current.signal,
          (attempt, max) => {
            setRetryInfo({attempt, max});
          },
          (streamText) => {
            setStreamingMessage(prev =>
              prev && prev.id === streamingMsgId
                ? {...prev, text: streamText}
                : prev,
            );
          },
          () => {
            setIsReasoning(true);
          },
          (durationMs) => {
            setIsReasoning(false);
            setReasoningDuration(durationMs);
          },
          (toolMessage) => {
            const nextMessage: Message = {
                id: Date.now() + 10_000 + toolMessageIdRef.current++,
                role: 'tool',
                text: toolMessage.text,
                timestamp: new Date(),
                toolPhase: toolMessage.phase,
              };
            activeToolMessagesRef.current = [
              ...activeToolMessagesRef.current,
              nextMessage,
            ];
            setActiveToolMessages(activeToolMessagesRef.current);
          },
        );
        setCommittedMessages(prev => [...prev, ...activeToolMessagesRef.current]);
        if (result.text) {
          const finalAssistantMessage: Message = {
            id: streamingMsgId,
            role: 'assistant',
            text: result.text,
            timestamp: streamingMessageRef.current?.timestamp ?? new Date(),
          };
          setCommittedMessages(prev => [...prev, finalAssistantMessage]);
        }
        setStreamingMessage(null);
        activeToolMessagesRef.current = [];
        setActiveToolMessages([]);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          setAlertMessage('当前请求已取消');
          const partialMessage = streamingMessageRef.current;
          if (partialMessage?.id === streamingMsgId && partialMessage.text.length > 0) {
            setCommittedMessages(prev => [...prev, partialMessage]);
          }
          setStreamingMessage(null);
          activeToolMessagesRef.current = [];
          setActiveToolMessages([]);
          return;
        }

        const message = error instanceof Error ? error.message : '未知错误';
        const errorMsg: Message = {
          id: Date.now() + 1,
          role: 'assistant',
          text: `请求失败：${message}`,
          timestamp: new Date(),
        };
        setStreamingMessage(null);
        activeToolMessagesRef.current = [];
        setActiveToolMessages([]);
        setCommittedMessages(prev => [...prev, errorMsg]);
      } finally {
      setLoading(false);
      setIsReasoning(false);
      setRetryInfo(null);
    }
  },
    [appendHistoryEntry, cwd, loading],
  );

  useEffect(() => {
    pastedContentsRef.current = pastedContents;
  }, [pastedContents]);

  useEffect(() => {
    historyListRef.current = historyList;
  }, [historyList]);

  useEffect(() => {
    streamingMessageRef.current = streamingMessage;
  }, [streamingMessage]);

  useEffect(() => {
    const loadHistory = async () => {
      const data:SessionHistory[] = await readHistoryJSONL();
      historyListRef.current = data;
      setHistoryList(data);
    };

    loadHistory();
  }, []);
  // usePaste((text:string) => {
  //     const normalizedText = normalizeLineEndings(text);
  //     if (shouldUsePastedPlaceholder(normalizedText)) {
  //        pasteCountRef.current+=1
  //        setPasteContents(prev => {
  //          const next = new Map(prev);
  //          next.set(pasteCountRef.current, normalizedText);
  //          return next;
  //        });
  //        setInput(prev => prev + formatPastedTextLabel(pasteCountRef.current, normalizedText));
  //     } else {
  //        setInput(prev => prev + normalizedText);
  //     }
  //     setCursorSyncKey(prev => prev + 1);
  // });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box
        flexDirection="column"
        flexShrink={0}
      >
        <MessageViewport
          headerLines={transcriptHeaderLines}
          messages={viewportMessages}
          width={messageWidth}
          height={messageViewportRows}
          nativeScrollback
          alertMessage={alertMessage}
          statusLine={statusLine}
        />
      </Box>

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
            suspendSubmit={commandSelectorVisible}
            suspendVerticalArrows={commandSelectorVisible}
            onChange={setInput}
            onSubmit={onSubmit}
            onCtrlC={handleCtrlC}
            onPasteText={handlePasteText}
            placeholder={loading ? '等待回复中...':""}
          />
        </Box>
        <Text  color={loading ? 'blue' : 'gray'}>{inputRule}</Text>

        {/* 命令选择器 */}
        {commandSelectorVisible && (
          <Box
            flexDirection="column"
          >
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

      <Box marginTop={1} justifyContent="space-between" flexShrink={0}>
        {exitHint ? (
          <Text  dimColor >再按一次 Ctrl+C 确认退出</Text>
        ) : (
          <Text   color="gray">Enter 发送 · 鼠标滚轮使用终端滚动 · Ctrl+C 退出</Text>
        )}
      </Box>
    </Box>
  );
}
