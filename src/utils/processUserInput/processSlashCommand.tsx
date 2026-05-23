import { feature } from 'bun:bundle';
import type { ContentBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources';
import { randomUUID } from 'crypto';
import { setPromptId } from '../../bootstrap/state.js';
import {  CommandResult, type Command,
  type CommandBase,}from "src/types/command.js"
import {
  builtInCommandNames,

  findCommand,
  getCommand,
  getCommandName,
  hasCommand,
} from 'src/commands.js';
import {stat}from "fs"
import type {  ToolUseContext } from 'src/Tool.js';
import { MalformedCommandError } from '../errors.js';
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
  createSystemMessage,
  createUserInterruptionMessage,
  createUserMessage,
  prepareUserContent,
  formatCommandInputTags,createCommandInputMessage,isSystemLocalCommandMessage
} from '../messages.js';
import { hasPermissionsToUseTool } from '../permissions/permissions.js';

import { parseSlashCommand } from '../slashCommandParsing.js';
import type { ProcessUserInputBaseResult, ProcessUserInputContext } from './processUserInput.js';
export const NO_CONTENT_MESSAGE = '(no content)'


type SlashCommandResult = ProcessUserInputBaseResult & {
  command: Command;
};
import { createSyntheticUserCaveatMessage } from '../messages.js';
/**
 * Determines if a string looks like a valid command name.
 * Valid command names only contain letters, numbers, colons, hyphens, and underscores.
 *
 * @param commandName - The potential command name to check
 * @returns true if it looks like a command name, false if it contains non-command characters
 */
export function looksLikeCommand(commandName: string): boolean {
  // Command names should only contain [a-zA-Z0-9:_-]
  // If it contains other characters, it's probably a file path or other input
  return !/[^a-zA-Z0-9:\-_]/.test(commandName);
}
export async function processSlashCommand(
  inputString: string,
  context: ProcessUserInputContext,
  precedingInputBlocks: ContentBlockParam[],
  uuid?: string,
  isAlreadyProcessing?: boolean,
  canUseTool?: CanUseToolFn,

): Promise<ProcessUserInputBaseResult> {
  const parsed = parseSlashCommand(inputString);
  if (!parsed) {
    const errorMessage = 'Commands are in the form `/command [args]`';
    return {
      messages: [
        createSyntheticUserCaveatMessage(),//创建用户注意消息
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

  const { commandName, args: parsedArgs } = parsed;


  // Check if it's a real command before processing
  if (!hasCommand(commandName, context.options.commands)) {//如果没有这个命令
    // Check if this looks like a command name vs a file path or other input
    // Also check if it's an actual file path that exists
    let isFilePath = false;//判断是不是路径
    try {
      await stat(`/${commandName}`,()=>{});//毕竟可能是相对的文件
      isFilePath = true;
    } catch {
      // Not a file path — treat as command name
    }
    if (looksLikeCommand(commandName) && !isFilePath) {//如果不是路径，但看起来像命令
      const unknownMessage = `Unknown skill: ${commandName}`;//未知skill错误
      return {
        messages: [
          createSyntheticUserCaveatMessage(),
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
    setPromptId(promptId);//如果都没命中命令，那么可能是用户的指令
    return {
      messages: [
        createUserMessage({
          content: prepareUserContent({ inputString, precedingInputBlocks }),
          uuid: uuid,
        }),
      ],
      shouldQuery: true,//应该进行查询
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
    isAlreadyProcessing,
    canUseTool,
    uuid,
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

  // 对于无效命令，请同时保留用户消息和错误
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
  const isCompactResult = false;

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


async function getMessagesForSlashCommand(
  commandName: string,
  args: string,
  context: ProcessUserInputContext,
  precedingInputBlocks: ContentBlockParam[],
  _isAlreadyProcessing?: boolean,
  canUseTool?: CanUseToolFn,
  uuid?: string,
): Promise<SlashCommandResult> {
  const command = getCommand(commandName, context.options.commands);


  try {
    switch (command.type) {//一般走local-jsx
      case 'local-jsx': {
        return new Promise<SlashCommandResult>(resolve => {
          let doneWasCalled = false;
          const onDone = (//onDone完成
            result?: string,
            options?: {
              display?: CommandResultDisplay;
              shouldQuery?: boolean;
              metaMessages?: string[];
              nextInput?: string;
              submitNextInput?: boolean;
            },
          ) => {
            doneWasCalled = true;
            context.setToolJSX?.({
              jsx: null,
              shouldHidePromptInput: false,
              clearLocalJSX: true,
            });
            // If display is 'skip', don't add any messages to the conversation
            if (options?.display === 'skip') {//如果不显示，那就不加任何消息到对话
              void resolve({
                messages: [],
                shouldQuery: false,
                command,
                nextInput: options?.nextInput,
                submitNextInput: options?.submitNextInput,
              });
              return;
            }

            // Meta messages are model-visible but hidden from the user
            const metaMessages = (options?.metaMessages ?? []).map((content: string) =>//meta消息系统可见用户不可见
              createUserMessage({ content, isMeta: true }),
            );

            // In fullscreen the command just showed as a centered modal
            // pane — the transient notification is enough feedback. The
            // "❯ /config" + "⎿ dismissed" transcript entries are
            // type:system subtype:local_command (user-visible but NOT sent
            // to the model), so skipping them doesn't affect model context.
            // Outside fullscreen keep them so scrollback shows what ran.
            // Only skip "<Name> dismissed" modal-close notifications —
            // commands that early-exit before showing a modal (/ultraplan
            // usage, /rename, /proactive) use display:system for actual
            // output that must reach the transcript.
            const skipTranscript =
              isFullscreenEnvEnabled() && typeof result === 'string' && result.endsWith(' dismissed');

            void resolve({
              messages:
                options?.display === 'system'
                  ? skipTranscript
                    ? metaMessages
                    : [
                        createCommandInputMessage(formatCommandInput(command, args)),
                        createCommandInputMessage(`<local-command-stdout>${result}</local-command-stdout>`),
                        ...metaMessages,
                      ]
                  : [
                      createUserMessage({
                        content: prepareUserContent({
                          inputString: formatCommandInput(command, args),
                          precedingInputBlocks,
                        }),
                      }),
                      result
                        ? createUserMessage({
                            content: `<local-command-stdout>${result}</local-command-stdout>`,
                          })
                        : createUserMessage({
                            content: `<local-command-stdout>${NO_CONTENT_MESSAGE}</local-command-stdout>`,
                          }),
                      ...metaMessages,
                    ],
              shouldQuery: options?.shouldQuery ?? false,
              command,
              nextInput: options?.nextInput,
              submitNextInput: options?.submitNextInput,
            });
          };

          void command
            .load()
            .then(mod => mod.call(onDone, { ...context, canUseTool }, args))
            .then(jsx => {
              if (jsx == null) return;
              if (context.options.isNonInteractiveSession) {
                void resolve({
                  messages: [],
                  shouldQuery: false,
                  command,
                });
                return;
              }
              // Guard: if onDone fired during mod.call() (early-exit path
              // that calls onDone then returns JSX), skip setToolJSX. This
              // chain is fire-and-forget — the outer Promise resolves when
              // onDone is called, so executeUserInput may have already run
              // its setToolJSX({clearLocalJSX: true}) before we get here.
              // Setting isLocalJSXCommand after clear leaves it stuck true,
              // blocking useQueueProcessor and TextInput focus.
              if (doneWasCalled) return;
              context.setToolJSX?.({
                jsx,
                shouldHidePromptInput: true,
                showSpinner: false,
                isLocalJSXCommand: true,
                isImmediate: command.immediate === true,
              });

            })
            .catch(e => {
              // If load()/call() throws and onDone never fired, the outer
              // Promise hangs forever, leaving queryGuard stuck in
              // 'dispatching' and deadlocking the queue processor.
              logError(e);
              if (doneWasCalled) return;
              doneWasCalled = true;
              context.setToolJSX?.({
                jsx: null,
                shouldHidePromptInput: false,
                clearLocalJSX: true,
              });
              void resolve({ messages: [], shouldQuery: false, command });
            });
        });
      }
      // case 'local': {
      //   const displayArgs = command.isSensitive && args.trim() ? '***' : args;
      //   const userMessage = createUserMessage({
      //     content: prepareUserContent({
      //       inputString: formatCommandInput(command, displayArgs),
      //       precedingInputBlocks,
      //     }),
      //   });

      //   try {
      //     const syntheticCaveatMessage = createSyntheticUserCaveatMessage();
      //     const mod = await command.load();
      //     const result = await mod.call(args, context);

      //     if (result.type === 'skip') {
      //       return {
      //         messages: [],
      //         shouldQuery: false,
      //         command,
      //       };
      //     }

      //     // Use discriminated union to handle different result types
      //     if (result.type === 'compact') {
      //       // Append slash command messages to messagesToKeep so that
      //       // attachments and hookResults come after user messages
      //       const slashCommandMessages = [
      //         syntheticCaveatMessage,
      //         userMessage,
      //         ...(result.displayText
      //           ? [
      //               createUserMessage({
      //                 content: `<local-command-stdout>${result.displayText}</local-command-stdout>`,
      //                 // --resume looks at latest timestamp message to determine which message to resume from
      //                 // This is a perf optimization to avoid having to recaculcate the leaf node every time
      //                 // Since we're creating a bunch of synthetic messages for compact, it's important to set
      //                 // the timestamp of the last message to be slightly after the current time
      //                 // This is mostly important for sdk / -p mode
      //                 timestamp: new Date(Date.now() + 100).toISOString(),
      //               }),
      //             ]
      //           : []),
      //       ];
      //       const compactionResultWithSlashMessages = {
      //         ...result.compactionResult,
      //         messagesToKeep: [...(result.compactionResult.messagesToKeep ?? []), ...slashCommandMessages],
      //       };
      //       // Reset microcompact state since full compact replaces all
      //       // messages — old tool IDs are no longer relevant. Budget state
      //       // (on toolUseContext) needs no reset: stale entries are inert
      //       // (UUIDs never repeat, so they're never looked up).
      //       resetMicrocompactState();
      //       return {
      //         messages: buildPostCompactMessages(compactionResultWithSlashMessages) as AssistantMessage[],
      //         shouldQuery: false,
      //         command,
      //       };
      //     }

      //     // Text result — use system message so it doesn't render as a user bubble
      //     return {
      //       messages: [
      //         userMessage,
      //         createCommandInputMessage(`<local-command-stdout>${result.value}</local-command-stdout>`),
      //       ],
      //       shouldQuery: false,
      //       command,
      //       resultText: result.value,
      //     };
      //   } catch (e) {
      //     logError(e);
      //     return {
      //       messages: [
      //         userMessage,
      //         createCommandInputMessage(`<local-command-stderr>${String(e)}</local-command-stderr>`),
      //       ],
      //       shouldQuery: false,
      //       command,
      //     };
      //   }
      // }
    }
  } catch (e) {
    if (e instanceof MalformedCommandError) {
      return {
        messages: [
          createUserMessage({
            content: prepareUserContent({
              inputString: e.message,
              precedingInputBlocks,
            }),
          }),
        ],
        shouldQuery: false,
        command,
      };
    }
    throw e;
  }
  return new Promise<SlashCommandResult>(()=>{});
}
function formatCommandInput(command: CommandBase, args: string): string {
  return formatCommandInputTags(getCommandName(command), args);
}
