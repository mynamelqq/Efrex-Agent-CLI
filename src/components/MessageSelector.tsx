import type { ContentBlock, ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { randomUUID, type UUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState } from 'src/state/AppState.js';
import {
  type DiffStats,
  fileHistoryEnabled,
} from 'src/utils/fileHistory.js';
import { logError } from 'src/utils/log.js';
import { Box, Text, Divider } from '@anthropic/ink';
import {
  createUserMessage,
  extractTag,
  isEmptyMessageText,
} from '../utils/messages.js';
import {
  BASH_STDERR_TAG,
  BASH_STDOUT_TAG,
  COMMAND_MESSAGE_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  TASK_NOTIFICATION_TAG,
  TEAMMATE_MESSAGE_TAG,
  TICK_TAG,
} from '../constants/xml.js';
function isTextBlock(block: ContentBlockParam): block is TextBlockParam {
  return block.type === 'text';
}

import type { Message, PartialCompactDirection, UserMessage } from 'src/package/message.js';
import * as path from 'path';
import { count } from '../utils/array.js';
import { formatRelativeTimeAgo, truncate } from '../utils/format.js';
import type { Theme } from '../utils/theme.js';
type RestoreOption = 'both' | 'conversation' | 'code' | 'summarize' | 'summarize_up_to' | 'nevermind';

function isSummarizeOption(option: RestoreOption | null): option is 'summarize' | 'summarize_up_to' {
  return option === 'summarize' || option === 'summarize_up_to';
}




export function selectableUserMessagesFilter(message: Message): message is UserMessage {
  if (message.type !== 'user') {
    return false;
  }
  if (Array.isArray(message.message!.content) && message.message!.content[0]?.type === 'tool_result') {
    return false;
  }
  if (message.isMeta) {
    return false;
  }
  if (message.isCompactSummary || message.isVisibleInTranscriptOnly) {
    return false;
  }

  const content = message.message!.content as (ContentBlockParam[]|ContentBlock[]|string);
  const lastBlock = typeof content === 'string' ? null : content![content!.length - 1];
  const messageText =
    typeof content === 'string' ? content.trim() : lastBlock && isTextBlock(lastBlock) ? lastBlock.text.trim() : '';

  // Filter out non-user-authored messages (command outputs, task notifications, ticks).
  if (
    messageText.indexOf(`<${LOCAL_COMMAND_STDOUT_TAG}>`) !== -1 ||
    messageText.indexOf(`<${LOCAL_COMMAND_STDERR_TAG}>`) !== -1 ||
    messageText.indexOf(`<${BASH_STDOUT_TAG}>`) !== -1 ||
    messageText.indexOf(`<${BASH_STDERR_TAG}>`) !== -1 ||
    messageText.indexOf(`<${TASK_NOTIFICATION_TAG}>`) !== -1 ||
    messageText.indexOf(`<${TICK_TAG}>`) !== -1 ||
    messageText.indexOf(`<${TEAMMATE_MESSAGE_TAG}`) !== -1
  ) {
    return false;
  }
  return true;
}