import { feature } from 'bun:bundle';
import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources';
import { randomUUID } from 'crypto';
import { setPromptId } from '../../bootstrap/state.js';
import {
  builtInCommandNames,
  type Command,
  type CommandBase,
  findCommand,
  getCommand,
  getCommandName,
  hasCommand,
  type PromptCommand,
} from 'src/commands.js';
import type {  ToolUseContext } from 'src/Tool.js';
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  NormalizedUserMessage,
  ProgressMessage,
  UserMessage,
} from 'src/package/message.js';
import type { QueuedCommand } from 'src/types/textInputTypes.js';
import {  getSessionId } from '../../bootstrap/state.js';
import { COMMAND_MESSAGE_TAG, COMMAND_NAME_TAG } from '../../constants/xml.js';
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js';
import type { CommandResultDisplay } from '../../types/command.js';
import { createAbortController } from '../abortController.js';
import { logForDebugging } from '../debug.js';
import { isEnvTruthy } from '../envUtils.js';
import { AbortError } from '../errors.js';
import { getDisplayPath } from '../file.js';
import { isFullscreenEnvEnabled } from '../fullscreen.js';
import { toArray } from '../generators.js';
import { logError } from '../log.js';
import { enqueue, enqueuePendingNotification } from '../messageQueueManager.js';
import {

  createUserInterruptionMessage,
  createUserMessage,

} from '../messages.js';
import { hasPermissionsToUseTool } from '../permissions/permissions.js';
import { isRestrictedToPluginOnly, isSourceAdminTrusted } from '../settings/pluginOnlyPolicy.js';
import { parseSlashCommand } from '../slashCommandParsing.js';
import type { ProcessUserInputBaseResult, ProcessUserInputContext } from './processUserInput.js';

type SlashCommandResult = ProcessUserInputBaseResult & {
  command: Command;
};



export async function processSlashCommand(
  inputString: string,
  precedingInputBlocks: ContentBlockParam[],
  imageContentBlocks: ContentBlockParam[],
  attachmentMessages: AttachmentMessage[],
  context: ProcessUserInputContext,
  uuid?: string,
  isAlreadyProcessing?: boolean,
  canUseTool?: CanUseToolFn,
  autonomy?: QueuedCommand['autonomy'],
): Promise<ProcessUserInputBaseResult> {
  const parsed = parseSlashCommand(inputString);
  if (!parsed) {
    const errorMessage = 'Commands are in the form `/command [args]`';
    return {
      messages: [
        createSyntheticUserCaveatMessage(),
        ...attachmentMessages,
        createUserMessage({
          content: prepareUserContent({
            inputString: errorMessage,
            precedingInputBlocks,
          }),
        }),
      ],
      shouldQuery: false,
      resultText: errorMessage,
    };
  }

  const { commandName, args: parsedArgs, isMcp } = parsed;


  // Check if it's a real command before processing
  if (!hasCommand(commandName, context.options.commands)) {
    // Check if this looks like a command name vs a file path or other input
    // Also check if it's an actual file path that exists
    let isFilePath = false;
    try {
      await stat(`/${commandName}`);
      isFilePath = true;
    } catch {
      // Not a file path — treat as command name
    }
    if (looksLikeCommand(commandName) && !isFilePath) {
      logEvent('tengu_input_slash_invalid', {
        input: commandName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      });

      const unknownMessage = `Unknown skill: ${commandName}`;
      return {
        messages: [
          createSyntheticUserCaveatMessage(),
          ...attachmentMessages,
          createUserMessage({
            content: prepareUserContent({
              inputString: unknownMessage,
              precedingInputBlocks,
            }),
          }),
          // gh-32591: preserve args so the user can copy/resubmit without
          // retyping. System warning is UI-only (filtered before API).
          ...(parsedArgs ? [createSystemMessage(`Args from unknown skill: ${parsedArgs}`, 'warning')] : []),
        ],
        shouldQuery: false,
        resultText: unknownMessage,
      };
    }

    const promptId = randomUUID();
    setPromptId(promptId);
    return {
      messages: [
        createUserMessage({
          content: prepareUserContent({ inputString, precedingInputBlocks }),
          uuid: uuid,
        }),
        ...attachmentMessages,
      ],
      shouldQuery: true,
    };
  }

  // Track slash command usage for feature discovery

  const {
    messages: newMessages,
    shouldQuery: messageShouldQuery,
    allowedTools,
    model,
    effort,
    command: returnedCommand,
    resultText,
    nextInput,
    submitNextInput,
    deferAutonomyCompletion,
  } = await getMessagesForSlashCommand(
    commandName,
    parsedArgs,
    context,
    precedingInputBlocks,
    imageContentBlocks,
    isAlreadyProcessing,
    canUseTool,
    uuid,
    autonomy,
  );

  // Local slash commands that skip messages
  if (newMessages.length === 0) {
    return {
      messages: [],
      shouldQuery: false,

      model,
      nextInput,
      submitNextInput,
      deferAutonomyCompletion,
    };
  }

  // For invalid commands, preserve both the user message and error
  if (
    newMessages.length === 2 &&
    newMessages[1]!.type === 'user' &&
    typeof newMessages[1]!.message.content === 'string' &&
    newMessages[1]!.message.content.startsWith('Unknown command:')
  ) {
    // Don't log as invalid if it looks like a common file path
    const looksLikeFilePath =
      inputString.startsWith('/var') || inputString.startsWith('/tmp') || inputString.startsWith('/private');

    return {
      messages: [createSyntheticUserCaveatMessage(), ...newMessages],
      shouldQuery: messageShouldQuery,
      allowedTools,

      model,
    };
  }
  // Check if this is a compact result which handle their own synthetic caveat message ordering
  const isCompactResult = newMessages.length > 0 && newMessages[0] && isCompactBoundaryMessage(newMessages[0]);

  return {
    messages:
      messageShouldQuery || newMessages.every(isSystemLocalCommandMessage) || isCompactResult
        ? newMessages
        : [createSyntheticUserCaveatMessage(), ...newMessages],
    shouldQuery: messageShouldQuery,
    allowedTools,
    model,
    effort,
    resultText,
    nextInput,
    submitNextInput,
    deferAutonomyCompletion,
  };
}