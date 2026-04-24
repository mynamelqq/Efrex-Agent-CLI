import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Text, useApp, usePaste, useStdout} from 'ink';
import {Alert} from '@inkjs/ui';
import Select from 'ink-select-input';
import {askOpenAI} from './src/openai.js';
import { appendFileSync } from 'node:fs';
import {randomUUID} from 'crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {PastedContent, readHistoryJSONL, saveSessionHistory, SessionHistory} from './utils/load.js';
import PromptInput from './src/components/PromptInput.js';
import MarkdownText from './src/components/MarkdownText.js';
import {formatPastedTextLabel} from './hooks/format.js';
import {parseCommand} from './src/commands.js';
type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
};

const ThinkingIndicator = ({ reasoningDuration }: { reasoningDuration?: number }) => {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % frames.length);
      setElapsed(Date.now() - startTimeRef.current);
    }, 80);
    return () => clearInterval(timer);
  }, []);

  const displayMs = reasoningDuration ?? elapsed;
  const seconds = Math.floor(displayMs / 1000);

  return (
    <Box>
      <Text color="blueBright">{frames[frame]} </Text>
      <Text color="cyanBright">Efrex 正在思考</Text>
      <Text color="gray">... ({seconds}s)</Text>
    </Box>
  );
};

function chunkLine(text: string, width: number): string[] {
  if (width <= 0) {
    return [text];
  }

  const chars = Array.from(text);
  if (chars.length === 0) {
    return [''];
  }

  const lines: string[] = [];
  for (let index = 0; index < chars.length; index += width) {
    lines.push(chars.slice(index, index + width).join(''));
  }

  return lines;
}

function getHighlightedUserLines(text: string, width: number): string[] {
  const contentWidth = Math.max(1, width - 2);
  const rawLines = text.split('\n');

  return rawLines.flatMap((line, lineIndex) => {
    const chunks = chunkLine(line, contentWidth);

    return chunks.map((chunk, chunkIndex) => {
      const prefix = lineIndex === 0 && chunkIndex === 0 ? '> ' : '  ';
      return `${prefix}${chunk}`;
    });
  });
}

const MessageBubble = ({message, width}: {message: Message; width: number}) => {
  const isUser = message.role === 'user';
  const highlightedLines = isUser ? getHighlightedUserLines(message.text, width) : [];

  return (
    <Box flexDirection="column" marginBottom={1}>
      {isUser ? (
        <Box flexDirection="column">
          {highlightedLines.map((line, index) => (
            <Box key={`${message.id}-${index}`} width={width} backgroundColor="gray">
              <Text color="white">
                {line}
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box flexDirection="row">
          <Text color="White" bold>●  </Text>
          <Text color="white" wrap="wrap">
            <MarkdownText text={message.text} />
          </Text>
        </Box>
      )}
    </Box>
  );
};

const MASCOT = ['  /\\_/\\\\', ' ( o.o )', '  > ^ <'];

function getCurrentModel(): string {
  try {
    const settingPath = path.join(process.cwd(), 'setting.json');
    const content = readFileSync(settingPath, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed?.env?.ANTHROPIC_MODEL || 'gpt-5';
  } catch {
    return 'gpt-5';
  }
}

function getEffortLevel(): string {
  try {
    const settingPath = path.join(process.cwd(), 'setting.json');
    const content = readFileSync(settingPath, 'utf-8');
    const parsed = JSON.parse(content);
    return parsed?.effortLevel || 'medium';
  } catch {
    return 'medium';
  }
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

const Header = ({cwd, model, effort, key}: {cwd: string; model: string; effort: string; key: number}) => (
  <Box
    key={key}
    borderStyle="round"
    borderColor="blue"
    paddingX={1}
    paddingY={0}
    marginBottom={0}
    justifyContent="space-between"
  >
    <Box flexDirection="column">
      <Box alignItems="center">
        <Text bold color="blueBright">
          Efrex
        </Text>
        <Text color="gray"> terminal assistant</Text>
      </Box>
      <Box>
        <Text color="gray">{cwd}  ·  model: {model}  ·  effort: {effort}</Text>
      </Box>
    </Box>
    <Box flexDirection="column" marginLeft={2}>
      {MASCOT.map(line => (
        <Text key={line} color="cyanBright">
          {line}
        </Text>
      ))}
    </Box>
  </Box>
);

function resolvePastedPlaceholders(text: string, pastedMap: Map<number, string>) {
  const usedIds = new Set<number>();
  const resolvedText = text.replace(/\[Pasted #(\d+) (?:\d+ lines|\d+ characters)\]/g, (match, idText) => {
    const id = Number(idText);
    const pastedText = pastedMap.get(id);
    if (pastedText === undefined) {
      return match;
    }
    usedIds.add(id);
    return pastedText;
  });

  return {resolvedText, usedIds};
}
function resolvePastedPlaceholdersByObj(
  text: string, 
  pastedObj: { [key: string]: PastedContent }
) {
  const usedIds = new Set<number>();
  const resolvedText = text.replace(/\[Pasted #(\d+) (?:\d+ lines|\d+ characters)\]/g, (match, idText) => {
    const id = Number(idText);
    const pastedText = pastedObj[id.toString()]?.content;
    if (pastedText === undefined) {
      return match;
    }
    usedIds.add(id);
    return pastedText;
  });

  return { resolvedText, usedIds };
}
function toPastedContentsRecord(pastedMap: Map<number, string>, usedIds: Set<number>) {
  return Object.fromEntries(
    Array.from(usedIds).flatMap(id => {
      const content = pastedMap.get(id);
      if (content === undefined) {
        return [];
      }

      return [[
      String(id),
      {id, type: 'text' as const, content},
      ]];
    }),
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

export default function App() {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const [input, setInput] = useState('');
  const [cursorSyncKey, setCursorSyncKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isReasoning, setIsReasoning] = useState(false);
  const [reasoningDuration, setReasoningDuration] = useState<number | null>(null);
  const [retryInfo, setRetryInfo] = useState<{attempt: number; max: number} | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [exitHint, setExitHint] = useState(false);
  const [pastedContents,setPasteContents]=useState(new Map<number,string>())
  const pasteCountRef = useRef(0);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController>(new AbortController());
  const [historyList, setHistoryList] = useState<SessionHistory[]>([]);
  const historyListRef = useRef<SessionHistory[]>([]);
  const [historyCursor, setHistoryCursor] = useState(-1);
  const historyCursorRef = useRef(-1);
  const [draftInput, setDraftInput] = useState('');
  const draftInputRef = useRef('');
  const [committedMessages, setCommittedMessages] = useState<Message[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<Message | null>(null);
  const streamingMessageRef = useRef<Message | null>(null);
  const [showCommandSelector, setShowCommandSelector] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState(commands);
  const [modelRefreshKey, setModelRefreshKey] = useState(0);
  const cwd: string = process.cwd();
  const model = getCurrentModel();
  const effort = getEffortLevel();
  const inputRule = '─'.repeat(Math.max(8, stdout.columns - 2));
  const messageWidth = Math.max(8, stdout.columns - 2);

  // 过滤命令
  useEffect(() => {
    if (input.startsWith('/')) {
      const searchTerm = input.toLowerCase();
      const filtered = commands.filter(cmd =>
        cmd.label.toLowerCase().includes(searchTerm)
      );
      setFilteredCommands(filtered);
      setShowCommandSelector(filtered.length > 0);
    } else {
      setShowCommandSelector(false);
    }
  }, [input]);

  // 处理命令选择
  const handleCommandSelect = (item: {value: string}) => {
    setInput(item.value);
    setCursorSyncKey(prev => prev + 1);
    setShowCommandSelector(false);
  };

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

  const handleHistoryPrev = useCallback(() => {
    if (showCommandSelector) {
      return;
    }

    setHistoryCursor(prev => {
      if (historyList.length === 0) return -1;
      if (prev === -1) {
        setDraftInput(input);
        const newIndex = historyList.length - 1;
        setInput(historyList[newIndex].display);
        setCursorSyncKey(key => key + 1);
        return newIndex;
      }

      const newIndex = Math.max(0, prev - 1);
      setInput(historyList[newIndex].display);
      setCursorSyncKey(key => key + 1);
      return newIndex;
    });
  }, [historyList, input, showCommandSelector]);

  const handleHistoryNext = useCallback(() => {
    if (showCommandSelector) {
      return;
    }

    setHistoryCursor(prev => {
      if (prev === -1) return -1;
      if (prev >= historyList.length - 1) {
        setInput(draftInput);
        setCursorSyncKey(key => key + 1);
        return -1;
      }
      const newIndex = prev + 1;
      if (newIndex >= historyList.length) {
        setInput(draftInput);
        setCursorSyncKey(key => key + 1);
        return -1;
      }
      setInput(historyList[newIndex].display);
      setCursorSyncKey(key => key + 1);
      return newIndex;
    });
  }, [draftInput, historyList, showCommandSelector]);
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
        setHistoryCursor(-1);
        setDraftInput('');
        return;
      }

      const pastedHistoryText:{ [key: string]: PastedContent }=historyListRef.current[historyCursorRef.current]?.pastedContents;
      const {resolvedText, usedIds}=historyCursorRef.current==-1?resolvePastedPlaceholders(text, pastedContents)
      :resolvePastedPlaceholdersByObj(text,pastedHistoryText);
      if(historyCursorRef.current!=-1){
          const newHistory=historyListRef.current[historyCursorRef.current]
          saveSessionHistory(newHistory);
          setHistoryList(prev => {
            return [...prev, newHistory];
          });
      };
      // 每次请求创建新的 AbortController
      controllerRef.current = new AbortController();
      const sessionId = randomUUID();
      const userMsg: Message = {
        id: Date.now(),
        role: 'user',
        text: resolvedText,
        timestamp: new Date(),
      };
      const newHistory: SessionHistory = {
        display: text,
        pastedContents: toPastedContentsRecord(pastedContents, usedIds),
        timestamp: Date.now(),
        project: cwd,
        sessionId: sessionId,
      };
      saveSessionHistory(newHistory);
      setHistoryList(prev => {
        return [...prev, newHistory];
      });
      setCommittedMessages(prev => [...prev, userMsg]);
      setInput('');
      setHistoryCursor(-1);
      setDraftInput('');
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
          resolvedText,
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
        );
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
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          setAlertMessage('当前请求已取消');
          const partialMessage = streamingMessageRef.current;
          if (partialMessage?.id === streamingMsgId && partialMessage.text.length > 0) {
            setCommittedMessages(prev => [...prev, partialMessage]);
          }
          setStreamingMessage(null);
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
        setCommittedMessages(prev => [...prev, errorMsg]);
      } finally {
      setLoading(false);
      setIsReasoning(false);
      setRetryInfo(null);
    }
  },
    [cwd, loading, pastedContents],
  );
  useEffect(() => {
    historyListRef.current = historyList;
  }, [historyList]);

  useEffect(() => {
    historyCursorRef.current = historyCursor;
  }, [historyCursor]);

  useEffect(() => {
    draftInputRef.current = draftInput;
  }, [draftInput]);

  useEffect(() => {
    streamingMessageRef.current = streamingMessage;
  }, [streamingMessage]);

  useEffect(() => {
    const loadHistory = async () => {
      const data:SessionHistory[] = await readHistoryJSONL();
      setHistoryList(data);
    };

    loadHistory();
  }, []);
  usePaste((text:string) => {
      const normalizedText = normalizeLineEndings(text);
      if (shouldUsePastedPlaceholder(normalizedText)) {
         pasteCountRef.current+=1
         setPasteContents(prev => {
           const next = new Map(prev);
           next.set(pasteCountRef.current, normalizedText);
           return next;
         });
         setInput(prev => prev + formatPastedTextLabel(pasteCountRef.current, normalizedText));
      } else {
         setInput(prev => prev + normalizedText);
      }
      setCursorSyncKey(prev => prev + 1);
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Header cwd={cwd} model={model} effort={effort} key={modelRefreshKey} />

      <Box flexDirection="column" paddingX={1} flexGrow={1} flexShrink={1} overflowY="hidden">
        {alertMessage && (
          <Alert variant="error">{alertMessage}</Alert>
        )}
        {committedMessages.map(message => (
          <Box key={message.id} flexDirection="column">
            <MessageBubble message={message} width={messageWidth} />
          </Box>
        ))}
        {streamingMessage && (
          <Box key={streamingMessage.id} flexDirection="column">
            <MessageBubble message={streamingMessage} width={messageWidth} />
          </Box>
        )}
        {loading && !retryInfo && isReasoning && <ThinkingIndicator reasoningDuration={reasoningDuration ?? undefined} />}
        {loading && retryInfo && (
          <Box>
            <Text color="yellow">⟳ 正在连接重试 {retryInfo.attempt}/{retryInfo.max}...</Text>
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={loading ? 'blue' : 'gray'}>{inputRule}</Text>
        <Box>
          <Text color={loading ? 'blueBright' : 'greenBright'}>› </Text>
          <PromptInput
            value={input}
            width={Math.max(8, stdout.columns - 6)}
            cursorSyncKey={cursorSyncKey}
            isActive
            suspendSubmit={showCommandSelector}
            suspendVerticalArrows={showCommandSelector}
            onChange={setInput}
            onSubmit={onSubmit}
            onHistoryPrev={handleHistoryPrev}
            onHistoryNext={handleHistoryNext}
            onCtrlC={handleCtrlC}
            placeholder={loading ? '等待回复中...':""}
          />
        </Box>
        <Text  color={loading ? 'blue' : 'gray'}>{inputRule}</Text>

        {/* 命令选择器 */}
        {showCommandSelector && (
          <Box
            flexDirection="column"
          >
            <Select
              items={filteredCommands}
              onSelect={handleCommandSelect}
              limit={5}
            />
          </Box>
        )}
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        {exitHint ? (
          <Text  dimColor >再按一次 Ctrl+C 确认退出</Text>
        ) : (
          <Text   color="gray">Enter 发送 · Ctrl+C 退出</Text>
        )}
      </Box>
    </Box>
  );
}
