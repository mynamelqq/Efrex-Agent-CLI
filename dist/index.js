#!/usr/bin/env node
import {
  askOpenAI,
  attachErrorLogSink,
  createFileErrorSink,
  logError,
  setCwdState,
  setOriginalCwd,
  setProjectRoot
} from "./chunk-U3Q47KPP.js";

// index.tsx
import React2 from "react";
import path3 from "path";

// app.tsx
import { useCallback, useEffect as useEffect2, useRef, useState as useState2 } from "react";
import { Box as Box2, Text as Text3, useApp, usePaste, useStdout } from "ink";
import { Alert } from "@inkjs/ui";
import Select from "ink-select-input";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path2 from "path";

// utils/load.ts
import { cwd } from "process";
import { homedir } from "os";
import { join } from "path";
import { appendFileSync } from "fs";
import { existsSync, mkdirSync } from "fs";
import { createReadStream } from "fs";
import readline from "readline";
import { appendFile } from "fs/promises";
function trustFoler() {
  ensureDirSync();
  const dirPath = join(homedir(), ".efrex", "projects", pathToDisplayNameSimple(cwd()));
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
function ensureDirSync() {
  const projectFolder = join(homedir(), ".efrex", "projects", "");
  if (!existsSync(projectFolder)) {
    mkdirSync(projectFolder, { recursive: true });
  }
}
function isWorkSpaceTruested() {
  ensureDirSync();
  const dirPath = join(homedir(), ".efrex", "projects", pathToDisplayNameSimple(cwd()));
  if (!existsSync(dirPath)) {
    return false;
  } else {
    return true;
  }
}
function pathToDisplayNameSimple(filePath) {
  return filePath.replace(/:/g, "").replace(/\\/g, "--");
}
async function readHistoryJSONL() {
  const historyJsonPath = join(homedir(), ".efrex", "history.jsonl");
  const sessions = [];
  try {
    const fileStream = createReadStream(historyJsonPath);
    const rl = readline.createInterface({ input: fileStream });
    for await (const line of rl) {
      if (line.trim()) {
        try {
          const obj = JSON.parse(line);
          if (obj && typeof obj === "object" && obj.sessionId && obj.project) {
            sessions.push(obj);
          } else {
            console.warn("\u8DF3\u8FC7\u65E0\u6548\u7684\u4F1A\u8BDD\u6570\u636E:", obj);
          }
        } catch (err) {
          console.error("\u89E3\u6790 JSON \u5931\u8D25:", line, err);
        }
      }
    }
    appendFileSync("./tmp/debug.log", `[Trace] \u6D88\u606F${sessions.length}} 
`);
    return sessions;
  } catch (err) {
    if (err.code === "ENOENT") {
      console.warn(`\u6587\u4EF6\u4E0D\u5B58\u5728: ${historyJsonPath}`);
      return [];
    }
    throw err;
  }
}
async function saveSessionHistory(newHistory) {
  const historyJsonPath = join(homedir(), ".efrex", "history.jsonl");
  const line = JSON.stringify(newHistory) + "\n";
  try {
    await appendFile(historyJsonPath, line);
  } catch (err) {
    console.error("\u5199\u5165\u5931\u8D25:", err);
  }
}

// src/components/PromptInput.tsx
import { Box, Text } from "ink";
import chalk from "chalk";

// src/hooks/useTextInput.ts
import { useEffect, useState } from "react";
import { useInput } from "ink";

// src/utils/Cursor.ts
var graphemeSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
var wordSegmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(void 0, { granularity: "word" }) : null;
var Cursor = class _Cursor {
  constructor(text, offset = text.length, selection = 0, preferredColumn = null) {
    this.text = text;
    this.selection = selection;
    this.preferredColumn = preferredColumn;
    this.offset = clamp(offset, 0, text.length);
  }
  text;
  selection;
  preferredColumn;
  offset;
  sync(text, offset = text.length) {
    return new _Cursor(text, offset, 0, null);
  }
  insert(text) {
    const nextText = this.text.slice(0, this.offset) + text + this.text.slice(this.offset);
    return new _Cursor(nextText, this.offset + text.length, 0, null);
  }
  backspace() {
    if (this.offset === 0) {
      return this;
    }
    const previousOffset = previousGraphemeOffset(this.text, this.offset);
    const nextText = this.text.slice(0, previousOffset) + this.text.slice(this.offset);
    return new _Cursor(nextText, previousOffset, 0, null);
  }
  deleteForward() {
    if (this.offset >= this.text.length) {
      return this;
    }
    const nextOffset = nextGraphemeOffset(this.text, this.offset);
    const nextText = this.text.slice(0, this.offset) + this.text.slice(nextOffset);
    return new _Cursor(nextText, this.offset, 0, null);
  }
  left() {
    return new _Cursor(this.text, previousGraphemeOffset(this.text, this.offset), 0, null);
  }
  right() {
    return new _Cursor(this.text, nextGraphemeOffset(this.text, this.offset), 0, null);
  }
  startOfLine(width) {
    const line = findVisualLine(this.text, this.offset, width);
    return new _Cursor(this.text, line.start, 0, null);
  }
  endOfLine(width) {
    const line = findVisualLine(this.text, this.offset, width);
    return new _Cursor(this.text, line.end, 0, null);
  }
  startOfInput() {
    return new _Cursor(this.text, 0, 0, null);
  }
  endOfInput() {
    return new _Cursor(this.text, this.text.length, 0, null);
  }
  killToLineEnd(width) {
    const line = findVisualLine(this.text, this.offset, width);
    if (line.end === this.offset) {
      return this;
    }
    const nextText = this.text.slice(0, this.offset) + this.text.slice(line.end);
    return new _Cursor(nextText, this.offset, 0, null);
  }
  clearToStart() {
    if (this.offset === 0) {
      return this;
    }
    return new _Cursor(this.text.slice(this.offset), 0, 0, null);
  }
  prevWord() {
    return new _Cursor(this.text, previousWordOffset(this.text, this.offset), 0, null);
  }
  nextWord() {
    return new _Cursor(this.text, nextWordOffset(this.text, this.offset), 0, null);
  }
  up(width) {
    return this.moveVertical(width, -1);
  }
  down(width) {
    return this.moveVertical(width, 1);
  }
  render({
    cursorChar = " ",
    mask,
    invert,
    width,
    maxVisibleLines
  }) {
    const sourceText = mask ? mask.repeat(this.text.length) : this.text;
    const lines = buildVisualLines(sourceText, width);
    const rendered = lines.map((line) => renderLine(line, this.offset, cursorChar, invert));
    if (!maxVisibleLines || rendered.length <= maxVisibleLines) {
      return rendered;
    }
    const currentLineIndex = findVisualLineIndex(lines, this.offset);
    const start = Math.max(0, currentLineIndex - maxVisibleLines + 1);
    return rendered.slice(start, start + maxVisibleLines);
  }
  moveVertical(width, direction) {
    const lines = buildVisualLines(this.text, width);
    const currentLineIndex = findVisualLineIndex(lines, this.offset);
    const targetLineIndex = currentLineIndex + direction;
    if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
      return this;
    }
    const currentLine = lines[currentLineIndex];
    const currentColumn = this.preferredColumn ?? this.offset - currentLine.start;
    const targetLine = lines[targetLineIndex];
    const targetOffset = targetLine.start + Math.min(currentColumn, targetLine.end - targetLine.start);
    return new _Cursor(this.text, targetOffset, 0, currentColumn);
  }
};
function renderLine(line, offset, cursorChar, invert) {
  const column = clamp(offset - line.start, 0, line.end - line.start);
  if (line.text.length === 0) {
    return column === 0 ? invert(cursorChar) : cursorChar;
  }
  let rendered = "";
  for (let i = 0; i < line.text.length; i++) {
    rendered += i === column ? invert(line.text[i]) : line.text[i];
  }
  if (column === line.text.length) {
    rendered += invert(cursorChar);
  }
  return rendered;
}
function findVisualLine(text, offset, width) {
  return buildVisualLines(text, width)[findVisualLineIndex(buildVisualLines(text, width), offset)];
}
function findVisualLineIndex(lines, offset) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (offset <= line.end) {
      return i;
    }
  }
  return Math.max(0, lines.length - 1);
}
function buildVisualLines(text, width) {
  const safeWidth = Math.max(1, width);
  const logicalLines = text.split("\n");
  const lines = [];
  let offset = 0;
  for (const logicalLine of logicalLines) {
    const graphemes = splitGraphemes(logicalLine);
    if (graphemes.length === 0) {
      lines.push({ start: offset, end: offset, text: "" });
      offset += 1;
      continue;
    }
    let localOffset = 0;
    while (localOffset < graphemes.length) {
      const chunk = graphemes.slice(localOffset, localOffset + safeWidth).join("");
      lines.push({
        start: offset + localOffset,
        end: offset + localOffset + chunk.length,
        text: chunk
      });
      localOffset += safeWidth;
    }
    offset += logicalLine.length + 1;
  }
  if (text.length === 0) {
    return [{ start: 0, end: 0, text: "" }];
  }
  return lines;
}
function splitGraphemes(text) {
  if (!graphemeSegmenter) {
    return Array.from(text);
  }
  return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
}
function previousGraphemeOffset(text, offset) {
  if (offset <= 0) {
    return 0;
  }
  const segmenter = graphemeSegmenter;
  if (!segmenter) {
    return Array.from(text.slice(0, offset)).slice(0, -1).join("").length;
  }
  let previous = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.index >= offset) {
      break;
    }
    previous = segment.index;
  }
  return previous;
}
function nextGraphemeOffset(text, offset) {
  if (offset >= text.length) {
    return text.length;
  }
  const segmenter = graphemeSegmenter;
  if (!segmenter) {
    return text.slice(0, Array.from(text.slice(offset))[0]?.length ? offset + Array.from(text.slice(offset))[0].length : offset + 1).length;
  }
  for (const segment of segmenter.segment(text)) {
    if (segment.index > offset) {
      return segment.index;
    }
  }
  return text.length;
}
function previousWordOffset(text, offset) {
  if (!wordSegmenter) {
    return previousGraphemeOffset(text, offset);
  }
  let previous = 0;
  for (const segment of wordSegmenter.segment(text)) {
    if (segment.index >= offset) {
      break;
    }
    if (segment.isWordLike) {
      previous = segment.index;
    }
  }
  return previous;
}
function nextWordOffset(text, offset) {
  if (!wordSegmenter) {
    return nextGraphemeOffset(text, offset);
  }
  for (const segment of wordSegmenter.segment(text)) {
    if (segment.index <= offset) {
      continue;
    }
    if (segment.isWordLike) {
      return segment.index;
    }
  }
  return text.length;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// src/hooks/useTextInput.ts
function useTextInput({
  value,
  width,
  cursorSyncKey = 0,
  isActive = true,
  suspendSubmit = false,
  suspendVerticalArrows = false,
  onChange,
  onSubmit,
  onHistoryPrev,
  onHistoryNext,
  onCtrlC
}) {
  const [cursor, setCursor] = useState(() => new Cursor(value, value.length));
  useEffect(() => {
    setCursor(new Cursor(value, value.length));
  }, [cursorSyncKey, value]);
  useEffect(() => {
    setCursor((previous) => previous.sync(value, Math.min(previous.offset, value.length)));
  }, [value]);
  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") {
        onCtrlC?.();
        return;
      }
      if (key.tab || key.shift && key.tab) {
        return;
      }
      if (key.return) {
        if (suspendSubmit) {
          return;
        }
        onSubmit?.(cursor.text);
        return;
      }
      if (key.upArrow) {
        if (suspendVerticalArrows) {
          return;
        }
        if (cursor.text.includes("\n")) {
          setCursor((previous) => previous.up(width));
        } else {
          onHistoryPrev?.();
        }
        return;
      }
      if (key.downArrow) {
        if (suspendVerticalArrows) {
          return;
        }
        if (cursor.text.includes("\n")) {
          setCursor((previous) => previous.down(width));
        } else {
          onHistoryNext?.();
        }
        return;
      }
      if (key.ctrl) {
        if (input === "p") {
          onHistoryPrev?.();
          return;
        }
        if (input === "n") {
          onHistoryNext?.();
          return;
        }
        const nextCursor2 = handleCtrl(input, cursor, width);
        if (nextCursor2 !== cursor) {
          setCursor(nextCursor2);
          if (nextCursor2.text !== cursor.text) {
            onChange(nextCursor2.text);
          }
        }
        return;
      }
      if (key.escape) {
        return;
      }
      let nextCursor = cursor;
      if (key.leftArrow) {
        nextCursor = cursor.left();
      } else if (key.rightArrow) {
        nextCursor = cursor.right();
      } else if (key.backspace) {
        nextCursor = cursor.backspace();
      } else if (key.delete) {
        nextCursor = cursor.deleteForward();
      } else if (input) {
        nextCursor = cursor.insert(input);
      }
      if (nextCursor === cursor) {
        return;
      }
      setCursor(nextCursor);
      if (nextCursor.text !== cursor.text) {
        onChange(nextCursor.text);
      }
    },
    { isActive }
  );
  return { cursor };
}
function handleCtrl(input, cursor, width) {
  switch (input) {
    case "a":
      return cursor.startOfLine(width);
    case "b":
      return cursor.left();
    case "d":
      return cursor.deleteForward();
    case "e":
      return cursor.endOfLine(width);
    case "f":
      return cursor.right();
    case "k":
      return cursor.killToLineEnd(width);
    case "u":
      return cursor.clearToStart();
    default:
      return cursor;
  }
}

// src/components/PromptInput.tsx
import { jsx } from "react/jsx-runtime";
function PromptInput({
  value,
  width,
  cursorSyncKey = 0,
  isActive = true,
  suspendSubmit = false,
  suspendVerticalArrows = false,
  placeholder = "",
  onChange,
  onSubmit,
  onHistoryPrev,
  onHistoryNext,
  onCtrlC
}) {
  const { cursor } = useTextInput({
    value,
    width,
    cursorSyncKey,
    isActive,
    suspendSubmit,
    suspendVerticalArrows,
    onChange,
    onSubmit,
    onHistoryPrev,
    onHistoryNext,
    onCtrlC
  });
  if (value.length === 0) {
    const renderedPlaceholder = isActive ? placeholder.length > 0 ? chalk.inverse(placeholder[0]) + chalk.gray(placeholder.slice(1)) : chalk.inverse(" ") : chalk.gray(placeholder);
    return /* @__PURE__ */ jsx(Text, { children: renderedPlaceholder });
  }
  const lines = cursor.render({
    width,
    invert: (text) => chalk.inverse(text)
  });
  return /* @__PURE__ */ jsx(Box, { flexDirection: "column", children: lines.map((line, index) => /* @__PURE__ */ jsx(Text, { children: line }, `${index}-${line.length}`)) });
}

// src/components/MarkdownText.tsx
import { Text as Text2 } from "ink";
import { Fragment, jsx as jsx2 } from "react/jsx-runtime";
function parseMarkdown(text) {
  const segments = [];
  let lastIndex = 0;
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    const [fullMatch, code, bold, italic1, italic2] = match;
    if (code) {
      segments.push({ type: "code", content: code.slice(1, -1) });
    } else if (bold) {
      segments.push({ type: "bold", content: bold.slice(2, -2) });
    } else if (italic1) {
      segments.push({ type: "italic", content: italic1.slice(1, -1) });
    } else if (italic2) {
      segments.push({ type: "italic", content: italic2.slice(1, -1) });
    }
    lastIndex = match.index + fullMatch.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  if (segments.length === 0) {
    return [{ type: "text", content: text }];
  }
  return segments;
}
function MarkdownText({ text }) {
  const segments = parseMarkdown(text);
  return /* @__PURE__ */ jsx2(Fragment, { children: segments.map((segment, index) => {
    switch (segment.type) {
      case "bold":
        return /* @__PURE__ */ jsx2(Text2, { color: "magentaBright", bold: true, children: segment.content }, index);
      case "italic":
        return /* @__PURE__ */ jsx2(Text2, { italic: true, color: "magenta", children: segment.content }, index);
      case "code":
        return /* @__PURE__ */ jsx2(Text2, { backgroundColor: "gray", color: "cyanBright", children: segment.content }, index);
      default:
        return /* @__PURE__ */ jsx2(Text2, { children: segment.content }, index);
    }
  }) });
}

// src/hooks/format.ts
function formatPastedTextLabel(index, text) {
  const chars = text.length;
  const lines = text.split(/\r?\n/).length;
  return lines > 3 ? `[Pasted #${index} ${lines} lines]` : `[Pasted #${index} ${chars} characters]`;
}

// src/commands.ts
import fs from "fs/promises";
import { homedir as homedir2 } from "os";
import path from "path";
async function updateSetting(key, value) {
  const settingPath = path.join(homedir2(), "/.efrex", "setting.json");
  const content = await fs.readFile(settingPath, "utf-8");
  const settings = JSON.parse(content);
  if (!settings.env) {
    settings.env = {};
  }
  settings.env[key] = value;
  await fs.writeFile(settingPath, JSON.stringify(settings, null, 2));
}
async function handleModelCommand(args) {
  const modelName = args.trim();
  if (!modelName) {
    return {
      success: false,
      message: "\u8BF7\u6307\u5B9A\u6A21\u578B\u540D\u79F0\uFF0C\u4F8B\u5982: /model glm-5.1"
    };
  }
  try {
    await updateSetting("ANTHROPIC_MODEL", modelName);
    const { resetSettings } = await import("./queryDemo-FFOYO247.js");
    resetSettings();
    return {
      success: true,
      message: `\u6A21\u578B\u5DF2\u5207\u6362\u5230: ${modelName}`,
      shouldContinueChat: false
    };
  } catch (error) {
    return {
      success: false,
      message: `\u5207\u6362\u6A21\u578B\u5931\u8D25: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
async function parseCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const parts = trimmed.slice(1).split(" ");
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(" ");
  switch (command) {
    case "model":
      return await handleModelCommand(args);
    case "help":
      return {
        success: true,
        message: "\u53EF\u7528\u547D\u4EE4:\n  /model <name>  - \u5207\u6362\u6A21\u578B\n  /help          - \u663E\u793A\u5E2E\u52A9",
        shouldContinueChat: false
      };
    default:
      return null;
  }
}

// app.tsx
import { homedir as homedir3 } from "os";
import { jsx as jsx3, jsxs } from "react/jsx-runtime";
var ThinkingIndicator = ({ reasoningDuration }) => {
  const [frame, setFrame] = useState2(0);
  const [elapsed, setElapsed] = useState2(0);
  const frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  const startTimeRef = useRef(Date.now());
  useEffect2(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
      setElapsed(Date.now() - startTimeRef.current);
    }, 80);
    return () => clearInterval(timer);
  }, []);
  const displayMs = reasoningDuration ?? elapsed;
  const seconds = Math.floor(displayMs / 1e3);
  return /* @__PURE__ */ jsxs(Box2, { children: [
    /* @__PURE__ */ jsxs(Text3, { color: "blueBright", children: [
      frames[frame],
      " "
    ] }),
    /* @__PURE__ */ jsx3(Text3, { color: "cyanBright", children: "Efrex \u6B63\u5728\u601D\u8003" }),
    /* @__PURE__ */ jsxs(Text3, { color: "gray", children: [
      "... (",
      seconds,
      "s)"
    ] })
  ] });
};
function chunkLine(text, width) {
  if (width <= 0) {
    return [text];
  }
  const chars = Array.from(text);
  if (chars.length === 0) {
    return [""];
  }
  const lines = [];
  for (let index = 0; index < chars.length; index += width) {
    lines.push(chars.slice(index, index + width).join(""));
  }
  return lines;
}
function getHighlightedUserLines(text, width) {
  const contentWidth = Math.max(1, width - 2);
  const rawLines = text.split("\n");
  return rawLines.flatMap((line, lineIndex) => {
    const chunks = chunkLine(line, contentWidth);
    return chunks.map((chunk, chunkIndex) => {
      const prefix = lineIndex === 0 && chunkIndex === 0 ? "> " : "  ";
      return `${prefix}${chunk}`;
    });
  });
}
var MessageBubble = ({ message, width }) => {
  const isUser = message.role === "user";
  const highlightedLines = isUser ? getHighlightedUserLines(message.text, width) : [];
  return /* @__PURE__ */ jsx3(Box2, { flexDirection: "column", marginBottom: 1, children: isUser ? /* @__PURE__ */ jsx3(Box2, { flexDirection: "column", children: highlightedLines.map((line, index) => /* @__PURE__ */ jsx3(Box2, { width, backgroundColor: "gray", children: /* @__PURE__ */ jsx3(Text3, { color: "white", children: line }) }, `${message.id}-${index}`)) }) : /* @__PURE__ */ jsxs(Box2, { flexDirection: "row", children: [
    /* @__PURE__ */ jsx3(Text3, { color: "White", bold: true, children: "\u25CF  " }),
    /* @__PURE__ */ jsx3(Text3, { color: "white", wrap: "wrap", children: /* @__PURE__ */ jsx3(MarkdownText, { text: message.text }) })
  ] }) });
};
var MASCOT = ["  /\\_/\\\\", " ( o.o )", "  > ^ <"];
function getCurrentModel() {
  try {
    const settingPath = path2.join(homedir3(), ".efrex", "setting.json");
    const content = readFileSync(settingPath, "utf-8");
    const parsed = JSON.parse(content);
    return parsed?.env?.ANTHROPIC_MODEL || "gpt-5";
  } catch {
    return "kimi-k2.6";
  }
}
function getEffortLevel() {
  try {
    const settingPath = path2.join(homedir3(), ".efrex", "setting.json");
    const content = readFileSync(settingPath, "utf-8");
    const parsed = JSON.parse(content);
    return parsed?.effortLevel || "medium";
  } catch {
    return "medium";
  }
}
var commands = [
  { label: "/model                         Change Your Model", value: "/model" },
  { label: "/init                         Initialize a new CLAUDE.md file with codebase documentation", value: "/init" },
  { label: "/add-dir                      Add a new working directory", value: "/add-dir" },
  { label: "/agents                       Manage agent configurations", value: "/agents" },
  { label: "/branch                       Create a branch of the current conversation at this point", value: "/branch" },
  { label: "/btw                          Ask a quick side question without interrupting the main conversation", value: "/btw" },
  { label: "/clear                        Start a new session with empty context", value: "/clear" },
  { label: "/color                        Set the prompt bar color for this session", value: "/color" },
  { label: "/compact                      Free up context by summarizing the conversation so far", value: "/compact" },
  { label: "/config                       Open config panel", value: "/config" },
  { label: "/context                      Visualize current context usage as a colored grid", value: "/context" },
  { label: "/copy                         Copy Claude's last response to clipboard (or /copy N for the Nth-latest)", value: "/copy" },
  { label: "/cost                         Show the total cost and duration of the current session", value: "/cost" },
  { label: "/diff                         View uncommitted changes and per-turn diffs", value: "/diff" },
  { label: "/doctor                       Diagnose and verify your Claude Code installation and settings", value: "/doctor" },
  { label: "/effort                       Set effort level for model usage", value: "/effort" },
  { label: "/exit                         Exit the CLI", value: "/exit" },
  { label: "/export                       Export the current conversation to a file or clipboard", value: "/export" },
  { label: "/fast                         Toggle fast mode (Opus 4.6 only)", value: "/fast" },
  { label: "/feedback                     Submit feedback about Claude Code", value: "/feedback" },
  { label: "/help                         Show help and available commands", value: "/help" },
  { label: "/hooks                        View hook configurations for tool events", value: "/hooks" },
  { label: "/ide                          Manage IDE integrations and show status", value: "/ide" },
  { label: "/keybindings                  Open or create your keybindings configuration file", value: "/keybindings" }
];
var Header = ({ cwd: cwd2, model, effort }) => /* @__PURE__ */ jsxs(
  Box2,
  {
    borderStyle: "round",
    borderColor: "blue",
    paddingX: 1,
    paddingY: 0,
    marginBottom: 0,
    justifyContent: "space-between",
    children: [
      /* @__PURE__ */ jsxs(Box2, { flexDirection: "column", children: [
        /* @__PURE__ */ jsxs(Box2, { alignItems: "center", children: [
          /* @__PURE__ */ jsx3(Text3, { bold: true, color: "blueBright", children: "Efrex" }),
          /* @__PURE__ */ jsx3(Text3, { color: "gray", children: " terminal assistant" })
        ] }),
        /* @__PURE__ */ jsx3(Box2, { children: /* @__PURE__ */ jsxs(Text3, { color: "gray", children: [
          cwd2,
          "  \xB7  model: ",
          model,
          "  \xB7  effort: ",
          effort
        ] }) })
      ] }),
      /* @__PURE__ */ jsx3(Box2, { flexDirection: "column", marginLeft: 2, children: MASCOT.map((line) => /* @__PURE__ */ jsx3(Text3, { color: "cyanBright", children: line }, line)) })
    ]
  }
);
function resolvePastedPlaceholders(text, pastedMap) {
  const usedIds = /* @__PURE__ */ new Set();
  const resolvedText = text.replace(/\[Pasted #(\d+) (?:\d+ lines|\d+ characters)\]/g, (match, idText) => {
    const id = Number(idText);
    const pastedText = pastedMap.get(id);
    if (pastedText === void 0) {
      return match;
    }
    usedIds.add(id);
    return pastedText;
  });
  return { resolvedText, usedIds };
}
function resolvePastedPlaceholdersByObj(text, pastedObj) {
  const usedIds = /* @__PURE__ */ new Set();
  const resolvedText = text.replace(/\[Pasted #(\d+) (?:\d+ lines|\d+ characters)\]/g, (match, idText) => {
    const id = Number(idText);
    const pastedText = pastedObj[id.toString()]?.content;
    if (pastedText === void 0) {
      return match;
    }
    usedIds.add(id);
    return pastedText;
  });
  return { resolvedText, usedIds };
}
function toPastedContentsRecord(pastedMap, usedIds) {
  return Object.fromEntries(
    Array.from(usedIds).flatMap((id) => {
      const content = pastedMap.get(id);
      if (content === void 0) {
        return [];
      }
      return [[
        String(id),
        { id, type: "text", content }
      ]];
    })
  );
}
function shouldUsePastedPlaceholder(text) {
  if (text.length >= 2e3) {
    return true;
  }
  const normalizedText = normalizeLineEndings(text);
  const textWithoutTrailingNewlines = normalizedText.replace(/\n+$/, "");
  if (!textWithoutTrailingNewlines) {
    return false;
  }
  const lineCount = textWithoutTrailingNewlines.split("\n").length;
  return lineCount > 3;
}
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [input, setInput] = useState2("");
  const [cursorSyncKey, setCursorSyncKey] = useState2(0);
  const [loading, setLoading] = useState2(false);
  const [isReasoning, setIsReasoning] = useState2(false);
  const [reasoningDuration, setReasoningDuration] = useState2(null);
  const [retryInfo, setRetryInfo] = useState2(null);
  const [alertMessage, setAlertMessage] = useState2(null);
  const [exitHint, setExitHint] = useState2(false);
  const [pastedContents, setPasteContents] = useState2(/* @__PURE__ */ new Map());
  const pasteCountRef = useRef(0);
  const exitTimerRef = useRef(null);
  const controllerRef = useRef(new AbortController());
  const [historyList, setHistoryList] = useState2([]);
  const historyListRef = useRef([]);
  const [historyCursor, setHistoryCursor] = useState2(-1);
  const historyCursorRef = useRef(-1);
  const [draftInput, setDraftInput] = useState2("");
  const draftInputRef = useRef("");
  const [committedMessages, setCommittedMessages] = useState2([]);
  const [streamingMessage, setStreamingMessage] = useState2(null);
  const streamingMessageRef = useRef(null);
  const [showCommandSelector, setShowCommandSelector] = useState2(false);
  const [filteredCommands, setFilteredCommands] = useState2(commands);
  const [modelRefreshKey, setModelRefreshKey] = useState2(0);
  const cwd2 = process.cwd();
  const model = getCurrentModel();
  const effort = getEffortLevel();
  const inputRule = "\u2500".repeat(Math.max(8, stdout.columns - 2));
  const messageWidth = Math.max(8, stdout.columns - 2);
  useEffect2(() => {
    if (input.startsWith("/")) {
      const searchTerm = input.toLowerCase();
      const filtered = commands.filter(
        (cmd) => cmd.label.toLowerCase().includes(searchTerm)
      );
      setFilteredCommands(filtered);
      setShowCommandSelector(filtered.length > 0);
    } else {
      setShowCommandSelector(false);
    }
  }, [input]);
  const handleCommandSelect = (item) => {
    setInput(item.value);
    setCursorSyncKey((prev) => prev + 1);
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
    setInput("");
    setExitHint(true);
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
    }
    exitTimerRef.current = setTimeout(() => {
      setExitHint(false);
      exitTimerRef.current = null;
    }, 3e3);
  }, [exit, exitHint, loading]);
  const handleHistoryPrev = useCallback(() => {
    if (showCommandSelector) {
      return;
    }
    setHistoryCursor((prev) => {
      if (historyList.length === 0) return -1;
      if (prev === -1) {
        setDraftInput(input);
        const newIndex2 = historyList.length - 1;
        setInput(historyList[newIndex2].display);
        setCursorSyncKey((key) => key + 1);
        return newIndex2;
      }
      const newIndex = Math.max(0, prev - 1);
      setInput(historyList[newIndex].display);
      setCursorSyncKey((key) => key + 1);
      return newIndex;
    });
  }, [historyList, input, showCommandSelector]);
  const handleHistoryNext = useCallback(() => {
    if (showCommandSelector) {
      return;
    }
    setHistoryCursor((prev) => {
      if (prev === -1) return -1;
      if (prev >= historyList.length - 1) {
        setInput(draftInput);
        setCursorSyncKey((key) => key + 1);
        return -1;
      }
      const newIndex = prev + 1;
      if (newIndex >= historyList.length) {
        setInput(draftInput);
        setCursorSyncKey((key) => key + 1);
        return -1;
      }
      setInput(historyList[newIndex].display);
      setCursorSyncKey((key) => key + 1);
      return newIndex;
    });
  }, [draftInput, historyList, showCommandSelector]);
  const onSubmit = useCallback(
    async (value) => {
      const text = value.trim();
      if (!text || loading) return;
      setAlertMessage(null);
      const commandResult = await parseCommand(text);
      if (commandResult !== null) {
        if (!commandResult.success) {
          setAlertMessage(commandResult.message);
        } else {
          const systemMsg = {
            id: Date.now(),
            role: "assistant",
            text: commandResult.message,
            timestamp: /* @__PURE__ */ new Date()
          };
          setCommittedMessages((prev) => [...prev, systemMsg]);
          if (text.toLowerCase().startsWith("/model")) {
            setModelRefreshKey((prev) => prev + 1);
          }
        }
        setInput("");
        setHistoryCursor(-1);
        setDraftInput("");
        return;
      }
      const pastedHistoryText = historyListRef.current[historyCursorRef.current]?.pastedContents;
      const { resolvedText, usedIds } = historyCursorRef.current == -1 ? resolvePastedPlaceholders(text, pastedContents) : resolvePastedPlaceholdersByObj(text, pastedHistoryText);
      if (historyCursorRef.current != -1) {
        const newHistory2 = historyListRef.current[historyCursorRef.current];
        saveSessionHistory(newHistory2);
        setHistoryList((prev) => {
          return [...prev, newHistory2];
        });
      }
      ;
      controllerRef.current = new AbortController();
      const sessionId = randomUUID();
      const userMsg = {
        id: Date.now(),
        role: "user",
        text: resolvedText,
        timestamp: /* @__PURE__ */ new Date()
      };
      const newHistory = {
        display: text,
        pastedContents: toPastedContentsRecord(pastedContents, usedIds),
        timestamp: Date.now(),
        project: cwd2,
        sessionId
      };
      saveSessionHistory(newHistory);
      setHistoryList((prev) => {
        return [...prev, newHistory];
      });
      setCommittedMessages((prev) => [...prev, userMsg]);
      setInput("");
      setHistoryCursor(-1);
      setDraftInput("");
      const streamingMsgId = Date.now() + 1;
      setStreamingMessage({
        id: streamingMsgId,
        role: "assistant",
        text: "",
        timestamp: /* @__PURE__ */ new Date()
      });
      try {
        setLoading(true);
        setIsReasoning(false);
        setReasoningDuration(null);
        const result = await askOpenAI(
          resolvedText,
          controllerRef.current.signal,
          (attempt, max) => {
            setRetryInfo({ attempt, max });
          },
          (streamText) => {
            setStreamingMessage(
              (prev) => prev && prev.id === streamingMsgId ? { ...prev, text: streamText } : prev
            );
          },
          () => {
            setIsReasoning(true);
          },
          (durationMs) => {
            setIsReasoning(false);
            setReasoningDuration(durationMs);
          }
        );
        if (result.text) {
          const finalAssistantMessage = {
            id: streamingMsgId,
            role: "assistant",
            text: result.text,
            timestamp: streamingMessageRef.current?.timestamp ?? /* @__PURE__ */ new Date()
          };
          setCommittedMessages((prev) => [...prev, finalAssistantMessage]);
        }
        setStreamingMessage(null);
      } catch (error) {
        logError(error);
        if (error instanceof Error && error.name === "AbortError") {
          setAlertMessage("\u5F53\u524D\u8BF7\u6C42\u5DF2\u53D6\u6D88");
          const partialMessage = streamingMessageRef.current;
          if (partialMessage?.id === streamingMsgId && partialMessage.text.length > 0) {
            setCommittedMessages((prev) => [...prev, partialMessage]);
          }
          setStreamingMessage(null);
          return;
        }
        const message = error instanceof Error ? error.message : "\u672A\u77E5\u9519\u8BEF";
        const errorMsg = {
          id: Date.now() + 1,
          role: "assistant",
          text: `\u8BF7\u6C42\u5931\u8D25\uFF1A${message}`,
          timestamp: /* @__PURE__ */ new Date()
        };
        setStreamingMessage(null);
        setCommittedMessages((prev) => [...prev, errorMsg]);
      } finally {
        setLoading(false);
        setIsReasoning(false);
        setRetryInfo(null);
      }
    },
    [cwd2, loading, pastedContents]
  );
  useEffect2(() => {
    historyListRef.current = historyList;
  }, [historyList]);
  useEffect2(() => {
    historyCursorRef.current = historyCursor;
  }, [historyCursor]);
  useEffect2(() => {
    draftInputRef.current = draftInput;
  }, [draftInput]);
  useEffect2(() => {
    streamingMessageRef.current = streamingMessage;
  }, [streamingMessage]);
  useEffect2(() => {
    attachErrorLogSink(createFileErrorSink());
    const loadHistory = async () => {
      try {
        const data = await readHistoryJSONL();
        setHistoryList(data);
      } catch (err) {
        logError(err);
      }
    };
    loadHistory();
  }, []);
  usePaste((text) => {
    const normalizedText = normalizeLineEndings(text);
    if (shouldUsePastedPlaceholder(normalizedText)) {
      pasteCountRef.current += 1;
      setPasteContents((prev) => {
        const next = new Map(prev);
        next.set(pasteCountRef.current, normalizedText);
        return next;
      });
      setInput((prev) => prev + formatPastedTextLabel(pasteCountRef.current, normalizedText));
    } else {
      setInput((prev) => prev + normalizedText);
    }
    setCursorSyncKey((prev) => prev + 1);
  });
  return /* @__PURE__ */ jsxs(Box2, { flexDirection: "column", paddingX: 1, paddingY: 0, children: [
    /* @__PURE__ */ jsx3(Header, { cwd: cwd2, model, effort }, modelRefreshKey),
    /* @__PURE__ */ jsxs(Box2, { flexDirection: "column", paddingX: 1, flexGrow: 1, flexShrink: 1, overflowY: "hidden", children: [
      alertMessage && /* @__PURE__ */ jsx3(Alert, { variant: "error", children: alertMessage }),
      committedMessages.map((message) => /* @__PURE__ */ jsx3(Box2, { flexDirection: "column", children: /* @__PURE__ */ jsx3(MessageBubble, { message, width: messageWidth }) }, message.id)),
      streamingMessage && /* @__PURE__ */ jsx3(Box2, { flexDirection: "column", children: /* @__PURE__ */ jsx3(MessageBubble, { message: streamingMessage, width: messageWidth }) }, streamingMessage.id),
      loading && !retryInfo && isReasoning && /* @__PURE__ */ jsx3(ThinkingIndicator, { reasoningDuration: reasoningDuration ?? void 0 }),
      loading && retryInfo && /* @__PURE__ */ jsx3(Box2, { children: /* @__PURE__ */ jsxs(Text3, { color: "yellow", children: [
        "\u27F3 \u6B63\u5728\u8FDE\u63A5\u91CD\u8BD5 ",
        retryInfo.attempt,
        "/",
        retryInfo.max,
        "..."
      ] }) })
    ] }),
    /* @__PURE__ */ jsxs(Box2, { flexDirection: "column", marginTop: 1, children: [
      /* @__PURE__ */ jsx3(Text3, { color: loading ? "blue" : "gray", children: inputRule }),
      /* @__PURE__ */ jsxs(Box2, { children: [
        /* @__PURE__ */ jsx3(Text3, { color: loading ? "blueBright" : "greenBright", children: "\u203A " }),
        /* @__PURE__ */ jsx3(
          PromptInput,
          {
            value: input,
            width: Math.max(8, stdout.columns - 6),
            cursorSyncKey,
            isActive: true,
            suspendSubmit: showCommandSelector,
            suspendVerticalArrows: showCommandSelector,
            onChange: setInput,
            onSubmit,
            onHistoryPrev: handleHistoryPrev,
            onHistoryNext: handleHistoryNext,
            onCtrlC: handleCtrlC,
            placeholder: loading ? "\u7B49\u5F85\u56DE\u590D\u4E2D..." : ""
          }
        )
      ] }),
      /* @__PURE__ */ jsx3(Text3, { color: loading ? "blue" : "gray", children: inputRule }),
      showCommandSelector && /* @__PURE__ */ jsx3(
        Box2,
        {
          flexDirection: "column",
          children: /* @__PURE__ */ jsx3(
            Select,
            {
              items: filteredCommands,
              onSelect: handleCommandSelect,
              limit: 5
            }
          )
        }
      )
    ] }),
    /* @__PURE__ */ jsx3(Box2, { marginTop: 1, justifyContent: "space-between", children: exitHint ? /* @__PURE__ */ jsx3(Text3, { dimColor: true, children: "\u518D\u6309\u4E00\u6B21 Ctrl+C \u786E\u8BA4\u9000\u51FA" }) : /* @__PURE__ */ jsx3(Text3, { color: "gray", children: "Enter \u53D1\u9001 \xB7 Ctrl+C \u9000\u51FA" }) })
  ] });
}

// index.tsx
import { homedir as homedir4 } from "os";
import { Box as Box3, Text as Text4, render, useApp as useApp2, useInput as useInput2 } from "ink";
import { existsSync as existsSync2, mkdirSync as mkdirSync2 } from "fs";

// src/setup.ts
import { cwd as getProcessCwd } from "process";
function setup() {
  const cwd2 = getProcessCwd();
  setCwdState(cwd2);
  setOriginalCwd(cwd2);
  setProjectRoot(cwd2);
}

// index.tsx
import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
var TrustPrompt = ({ onTrust }) => {
  const { exit } = useApp2();
  const [selectedIndex, setSelectedIndex] = React2.useState(0);
  const options = [
    { label: "\u4FE1\u4EFB\u6B64\u5DE5\u4F5C\u76EE\u5F55", value: "trust" },
    { label: "\u4E0D\u4FE1\u4EFB\u5E76\u9000\u51FA", value: "reject" }
  ];
  useInput2((input, key) => {
    if (key.upArrow || key.downArrow) {
      setSelectedIndex((index) => index === 0 ? 1 : 0);
      return;
    }
    if (key.return) {
      if (options[selectedIndex]?.value === "trust") {
        trustFoler();
        onTrust();
      } else {
        exit();
      }
      return;
    }
    if (key.ctrl && input === "c") {
      exit();
    }
  });
  return /* @__PURE__ */ jsxs2(Box3, { flexDirection: "column", paddingX: 1, paddingY: 1, children: [
    /* @__PURE__ */ jsx4(Text4, { bold: true, color: "cyanBright", children: "Efrex \u5DE5\u4F5C\u76EE\u5F55\u4FE1\u4EFB\u786E\u8BA4" }),
    /* @__PURE__ */ jsx4(Box3, { marginTop: 1, children: /* @__PURE__ */ jsxs2(Text4, { dimColor: true, children: [
      "\u5F53\u524D\u76EE\u5F55: ",
      process.cwd()
    ] }) }),
    /* @__PURE__ */ jsx4(Box3, { marginTop: 1, flexDirection: "column", children: options.map((option, index) => {
      const selected = index === selectedIndex;
      return /* @__PURE__ */ jsxs2(Box3, { children: [
        /* @__PURE__ */ jsx4(Text4, { color: selected ? "greenBright" : "gray", children: selected ? "\u203A " : "  " }),
        /* @__PURE__ */ jsx4(Text4, { color: selected ? "greenBright" : void 0, children: option.label })
      ] }, option.value);
    }) }),
    /* @__PURE__ */ jsx4(Box3, { marginTop: 1, children: /* @__PURE__ */ jsx4(Text4, { dimColor: true, children: "\u2191/\u2193 \u9009\u62E9 \xB7 Enter \u786E\u8BA4 \xB7 Ctrl+C \u9000\u51FA" }) })
  ] });
};
var Root = () => {
  const [trusted, setTrusted] = React2.useState(isWorkSpaceTruested());
  if (!trusted) {
    return /* @__PURE__ */ jsx4(TrustPrompt, { onTrust: () => setTrusted(true) });
  }
  return /* @__PURE__ */ jsx4(App, {});
};
(async () => {
  setup();
  const efrexFolder = path3.join(homedir4(), ".efrex");
  if (!existsSync2(efrexFolder)) {
    mkdirSync2(efrexFolder, { recursive: true });
  }
  process.stdout.write("\x1B[2J\x1B[H");
  render(/* @__PURE__ */ jsx4(Root, {}), {
    exitOnCtrlC: false,
    alternateScreen: false
  });
})();
