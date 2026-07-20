/**
 * MCP add CLI subcommand
 *
 * Extracted from main.tsx to enable direct testing.
 */
import { type Command, Option } from '@commander-js/extra-typings'
import { cliError, cliOk } from 'src/cli/exit'
import { readClientSecret, saveMcpClientSecret } from 'src/services/mcp/auth'
import { addMcpConfig } from 'src/services/mcp/config'
import { describeMcpConfigFilePath, ensureConfigScope, ensureTransport, parseHeaders } from 'src/services/mcp/utils'


/**
 * Parses an array of environment variable strings into a key-value object
 * @param envVars Array of strings in KEY=VALUE format
 * @returns Object with key-value pairs
 */
export function parseEnvVars(
  rawEnvArgs: string[] | undefined,
): Record<string, string> {
  const parsedEnv: Record<string, string> = {}

  // Parse individual env vars
  if (rawEnvArgs) {
    for (const envStr of rawEnvArgs) {
      const [key, ...valueParts] = envStr.split('=')
      if (!key || valueParts.length === 0) {
        throw new Error(
          `Invalid environment variable format: ${envStr}, environment variables should be added as: -e KEY1=value1 -e KEY2=value2`,
        )
      }
      parsedEnv[key] = valueParts.join('=')
    }
  }
  return parsedEnv
}

/**
 * Registers the `mcp add` subcommand on the given Commander command.
 */
export function registerMcpAddCommand(mcp: Command): void {
  mcp
    .command('add <name> <commandOrUrl> [args...]')
    .description(
      'Add an MCP server to Efrex  Code.\n\n' +
        'Examples:\n' +
        '  # Add HTTP server:\n' +
        '  Efrex  mcp add --transport http sentry https://mcp.sentry.dev/mcp\n\n' +
        '  # Add HTTP server with headers:\n' +
        '  Efrex  mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer ..."\n\n' +
        '  # Add stdio server with environment variables:\n' +
        '  Efrex  mcp add -e API_KEY=xxx my-server -- npx my-mcp-server\n\n' +
        '  # Add stdio server with subprocess flags:\n' +
        '  Efrex  mcp add my-server -- my-command --some-flag arg1',
    )
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '-t, --transport <transport>',
      'Transport type (stdio, sse, http). Defaults to stdio if not specified.',
    )
    .option(
      '-e, --env <env...>',
      'Set environment variables (e.g. -e KEY=value)',
    )
    .option(
      '-H, --header <header...>',
      'Set WebSocket headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")',
    )
    .option('--client-id <clientId>', 'OAuth client ID for HTTP/SSE servers')//认证iD
    .option(
      '--client-secret',
      'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)',//提示词，认证密钥
    )
    .option(
      '--callback-port <port>',
      'Fixed port for OAuth callback (for servers requiring pre-registered redirect URIs)',
    )
    .helpOption('-h, --help', 'Display help for command')

    .action(async (name, commandOrUrl, args, options) => {
      // Commander.js handles -- natively: it consumes -- and everything after becomes args
      const actualCommand = commandOrUrl
      const actualArgs = args

      // If no name is provided, error
      if (!name) {
        cliError(
          'Error: Server name is required.\n' +
            'Usage: Efrex  mcp add <name> <command> [args...]',
        )
      } else if (!actualCommand) {
        cliError(
          'Error: Command is required when server name is provided.\n' +
            'Usage: Efrex  mcp add <name> <command> [args...]',
        )
      }

      try {
        const scope = ensureConfigScope(options.scope)
        const transport = ensureTransport(options.transport)


        // Check if transport was explicitly provided
        const transportExplicit = options.transport !== undefined

        // Check if the command looks like a URL (likely incorrect usage)
        const looksLikeUrl =
          actualCommand.startsWith('http://') ||
          actualCommand.startsWith('https://') ||
          actualCommand.startsWith('localhost') ||
          actualCommand.endsWith('/sse') ||
          actualCommand.endsWith('/mcp')


        if (transport === 'sse') {//SSE
          if (!actualCommand) {
            cliError('Error: URL is required for SSE transport.')
          }

          const headers = options.header
            ? parseHeaders(options.header)
            : undefined

          const callbackPort = options.callbackPort
            ? parseInt(options.callbackPort, 10)
            : undefined
          const oauth =
            options.clientId || callbackPort 
              ? {
                  ...(options.clientId ? { clientId: options.clientId } : {}),
                  ...(callbackPort ? { callbackPort } : {}),
                }
              : undefined

          const clientSecret =
            options.clientSecret && options.clientId
              ? await readClientSecret()
              : undefined

          const serverConfig = {
            type: 'sse' as const,
            url: actualCommand,
            headers,
            oauth,
          }
          await addMcpConfig(name, serverConfig, scope)

          if (clientSecret) {
            saveMcpClientSecret(name, serverConfig, clientSecret)
          }

          process.stdout.write(
            `Added SSE MCP server ${name} with URL: ${actualCommand} to ${scope} config\n`,
          )
          if (headers) {
            process.stdout.write(
              `Headers: ${JSON.stringify(headers, null, 2)}\n`,
            )
          }
        } else if (transport === 'http') {
          if (!actualCommand) {
            cliError('Error: URL is required for HTTP transport.')
          }

          const headers = options.header
            ? parseHeaders(options.header)
            : undefined

          const callbackPort = options.callbackPort
            ? parseInt(options.callbackPort, 10)
            : undefined
          const oauth =
            options.clientId || callbackPort 
              ? {
                  ...(options.clientId ? { clientId: options.clientId } : {}),
                  ...(callbackPort ? { callbackPort } : {}),
                }
              : undefined

          const clientSecret =
            options.clientSecret && options.clientId
              ? await readClientSecret()
              : undefined

          const serverConfig = {
            type: 'http' as const,
            url: actualCommand,
            headers,
            oauth,
          }
          await addMcpConfig(name, serverConfig, scope)

          if (clientSecret) {
            saveMcpClientSecret(name, serverConfig, clientSecret)
          }

          process.stdout.write(
            `Added HTTP MCP server ${name} with URL: ${actualCommand} to ${scope} config\n`,
          )
          if (headers) {
            process.stdout.write(
              `Headers: ${JSON.stringify(headers, null, 2)}\n`,
            )
          }
        } else {//stdio路径
          if (
            options.clientId ||
            options.clientSecret ||
            options.callbackPort
          ) {
            process.stderr.write(
              `Warning: --client-id, --client-secret, --callback-port, and --xaa are only supported for HTTP/SSE transports and will be ignored for stdio.\n`,
            )
          }

          // Warn if this looks like a URL but transport wasn't explicitly specified
          if (!transportExplicit && looksLikeUrl) {
            process.stderr.write(
              `\nWarning: The command "${actualCommand}" looks like a URL, but is being interpreted as a stdio server as --transport was not specified.\n`,
            )
            process.stderr.write(
              `If this is an HTTP server, use: Efrex  mcp add --transport http ${name} ${actualCommand}\n`,
            )
            process.stderr.write(
              `If this is an SSE server, use: Efrex  mcp add --transport sse ${name} ${actualCommand}\n`,
            )
          }

          const env = parseEnvVars(options.env)
          await addMcpConfig(
            name,
            { type: 'stdio', command: actualCommand, args: actualArgs, env },
            scope,
          )

          process.stdout.write(
            `Added stdio MCP server ${name} with command: ${actualCommand} ${actualArgs.join(' ')} to ${scope} config\n`,
          )
        }
        cliOk(`File modified: ${describeMcpConfigFilePath(scope)}`)//终端原生输出错误
      } catch (error) {
        cliError((error as Error).message)
      }
    })
}