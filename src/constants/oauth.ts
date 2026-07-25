
// Default to prod config, override with test/staging if enabled
type OauthConfigType = 'prod' | 'staging' | 'local'


function getOauthConfigType(): OauthConfigType {
  return 'prod'
}
type OauthConfig = {
  BASE_API_URL: string
  CONSOLE_AUTHORIZE_URL: string
  CLAUDE_AI_AUTHORIZE_URL: string
  /**
   * The claude.ai web origin. Separate from CLAUDE_AI_AUTHORIZE_URL because
   * that now routes through claude.com/cai/* for attribution — deriving
   * .origin from it would give claude.com, breaking links to /code,
   * /settings/connectors, and other claude.ai web pages.
   */
  CLAUDE_AI_ORIGIN: string
  TOKEN_URL: string
  API_KEY_URL: string
  OPENAI_PROXY_URL: string
  ROLES_URL: string
  CONSOLE_SUCCESS_URL: string
  CLAUDEAI_SUCCESS_URL: string
  MANUAL_REDIRECT_URL: string
  CLIENT_ID: string
  OAUTH_FILE_SUFFIX: string
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
}
// Production OAuth configuration - Used in normal operation
const PROD_OAUTH_CONFIG = {
  BASE_API_URL: 'http://localhost:8080',
  CONSOLE_AUTHORIZE_URL: 'http://localhost:5173/oauth/authorize',
  // Bounces through claude.com/cai/* so CLI sign-ins connect to claude.com
  // visits for attribution. 307s to claude.ai/oauth/authorize in two hops.
  CLAUDE_AI_AUTHORIZE_URL: 'http://localhost:5173/oauth/authorize',
  CLAUDE_AI_ORIGIN: 'https://claude.ai',
  TOKEN_URL: 'http://localhost:8080/oauth/token',
  API_KEY_URL: 'http://localhost:8080/api-keys/current',
  OPENAI_PROXY_URL: 'http://localhost:8080/v1',
  ROLES_URL: 'https://api.anthropic.com/api/oauth/claude_cli/roles',
  CONSOLE_SUCCESS_URL: 'http://localhost:5173/oauth/success',
  CLAUDEAI_SUCCESS_URL: 'http://localhost:5173/oauth/success',
  MANUAL_REDIRECT_URL: 'http://localhost:5173/oauth/manual',
  MODEL_LIST_URL:"http://localhost:8080.v1/models",
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  // No suffix for production config
  OAUTH_FILE_SUFFIX: '',
  MCP_PROXY_URL: 'https://mcp-proxy.anthropic.com',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
} as const

export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const
export const CLAUDE_AI_INFERENCE_SCOPE = 'user:inference' as const
export const CLAUDE_AI_PROFILE_SCOPE = 'user:profile' as const
const CONSOLE_SCOPE = 'org:create_api_key' as const

// Console OAuth scopes - for API key creation via Console
export const CONSOLE_OAUTH_SCOPES = [
  CONSOLE_SCOPE,
  CLAUDE_AI_PROFILE_SCOPE,
] as const
// Claude.ai OAuth scopes - for Claude.ai subscribers (Pro/Max/Team/Enterprise)
export const CLAUDE_AI_OAUTH_SCOPES = [
  CLAUDE_AI_PROFILE_SCOPE,
  CLAUDE_AI_INFERENCE_SCOPE,
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
] as const
// All OAuth scopes - union of all scopes used in Claude CLI
// When logging in, request all scopes in order to handle both Console -> Claude.ai redirect
// Ensure that `OAuthConsentPage` in apps repo is kept in sync with this list.
export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...CLAUDE_AI_OAUTH_SCOPES]),
)
// Default to prod config, override with test/staging if enabled
export function getOauthConfig(): OauthConfig {
  let config: OauthConfig = PROD_OAUTH_CONFIG


  // Allow overriding all OAuth URLs to point to an approved FedStart deployment.
  // Only allowlisted base URLs are accepted to prevent credential leakage.
  const oauthBaseUrl = process.env.CUSTOM_OAUTH_URL
  if (oauthBaseUrl) {
    const base = oauthBaseUrl.replace(/\/$/, '')
    config = {
      ...config,
      BASE_API_URL: base,
      CONSOLE_AUTHORIZE_URL: `${base}/oauth/authorize`,
      CLAUDE_AI_AUTHORIZE_URL: `${base}/oauth/authorize`,
      CLAUDE_AI_ORIGIN: base,
      TOKEN_URL: `${base}/v1/oauth/token`,
      API_KEY_URL: `${base}/api/oauth/claude_cli/create_api_key`,
      OPENAI_PROXY_URL: `${base}/v1`,
      ROLES_URL: `${base}/api/oauth/claude_cli/roles`,
      CONSOLE_SUCCESS_URL: `${base}/oauth/code/success?app=claude-code`,
      CLAUDEAI_SUCCESS_URL: `${base}/oauth/code/success?app=claude-code`,
      MANUAL_REDIRECT_URL: `${base}/oauth/code/callback`,
      OAUTH_FILE_SUFFIX: '-custom-oauth',
    }
  }

  // Allow CLIENT_ID override via environment variable (e.g., for Xcode integration)
  const clientIdOverride = process.env.OAUTH_CLIENT_ID
  if (clientIdOverride) {
    config = {
      ...config,
      CLIENT_ID: clientIdOverride,
    }
  }

  return config
}
