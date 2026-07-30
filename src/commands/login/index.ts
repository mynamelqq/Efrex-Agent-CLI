import type { Command } from 'src/types/command.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: 'Switch Anthropic accounts',
      // : 'Sign in with your Anthropic account',
    // Keep the login flow in the bottom command region. Returning from the
    // success view restores the prompt in place instead of moving the dialog
    // through the main scrollback area, which can leave stale rows behind in
    // short terminals.
    immediate: true,
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
