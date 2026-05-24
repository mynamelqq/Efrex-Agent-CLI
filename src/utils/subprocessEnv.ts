import { isEnvTruthy } from './envUtils.js'

/**
 * 在 GitHub 内运行时从子进程环境中剥离的环境变量
 * 行动。这可以防止提示注入攻击泄露秘密
 * 通过 Bash 工具命令中的 shell 扩展（例如 ${ANTHROPIC_API_KEY}）。
 *
 * 父 claude 进程保留这些变量（API 调用需要，懒惰）
 * 凭证读取）。仅清除子进程（bash、shell 快照、MCP stdio、LSP、hooks）。
 *
 * GITHUB_TOKEN /GH_TOKEN 故意不被擦除——包装脚本
 * (gh.sh) 需要它们调用 GitHub API。该令牌是工作范围的并且
 * 当工作流程结束时过期。
 */
const GHA_SUBPROCESS_SCRUB = [
  // Anthropic auth — claude re-reads these per-request, subprocesses don't need them
  'API_KEY',
  'AUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',

  // OTLP exporter headers — documented to carry Authorization=Bearer tokens
  // for monitoring backends; read in-process by OTEL SDK, subprocesses never need them
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',

  // Cloud provider creds — same pattern (lazy SDK reads)
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',

  // GitHub Actions OIDC — consumed by the action's JS before claude spawns;
  // leaking these allows minting an App installation token → repo takeover
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',

  // GitHub Actions artifact/cache API — cache poisoning → supply-chain pivot
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_RUNTIME_URL',

  // claude-code-action-specific duplicates — action JS consumes these during
  // prepare, before spawning claude. ALL_INPUTS contains anthropic_api_key as JSON.
  'ALL_INPUTS',
  'OVERRIDE_GITHUB_TOKEN',
  'DEFAULT_WORKFLOW_TOKEN',
  'SSH_SIGNING_KEY',
] as const

/**
 * 返回 process.env 的副本，其中敏感秘密被剥离，以供以下情况使用
 * 生成子进程（Bash 工具、shell 快照、MCP stdio 服务器、LSP
 * 服务器、shell 挂钩）。
 *
 * 在 CLAUDE_CODE_SUBPROCESS_ENV_SCRUB 上进行门控。克劳德代码动作设置了这个
 * 配置“allowed_non_write_users”时自动 -该标志
 * 将工作流程暴露给不受信任的内容（提示注入表面）。
 */
// 动态导入upstreamproxy模块后由init.ts注册
// 在 CCR 会议中。在非 CCR 初创公司中保持未定义状态，因此我们从不引入
// upstreamproxy module graph (upstreamproxy.ts + relay.ts) via a static import.
let _getUpstreamProxyEnv: (() => Record<string, string>) | undefined

/**
 * 从 init.ts 调用以在upstreamproxy之后连接代理环境函数
 * module has been lazily loaded. Must be called before any subprocess is spawned.
 */
export function registerUpstreamProxyEnvFn(
  fn: () => Record<string, string>,
): void {
  _getUpstreamProxyEnv = fn
}

export function subprocessEnv(): NodeJS.ProcessEnv {
  // CCR上游代理：注入HTTPS_PROXY + CA捆绑变量所以curl/gh/python
  // 在代理子进程中通过本地中继进行路由。当以下情况时返回 {}
  // 代理已禁用或未注册（非 CCR），因此这是外部无操作
  // CCR 集装箱。
  const proxyEnv = _getUpstreamProxyEnv?.() ?? {}

  if (!isEnvTruthy(process.env.SUBPROCESS_ENV_SCRUB)) {
    return Object.keys(proxyEnv).length > 0
      ? { ...process.env, ...proxyEnv }
      : process.env
  }
  const env = { ...process.env, ...proxyEnv }
  for (const k of GHA_SUBPROCESS_SCRUB) {
    delete env[k]
    // GitHub Actions 会自动为 `with:` 输入创建 INPUT_<NAME>，并进行复制
    // 像 INPUT_ANTHROPIC_API_KEY 这样的秘密。对于不是操作输入的变量不进行任何操作。
    delete env[`INPUT_${k}`]
  }
  return env
}
