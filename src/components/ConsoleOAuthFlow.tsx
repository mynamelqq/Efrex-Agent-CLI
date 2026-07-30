import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Box, Text, useInput, useStdin } from '../ink.js';
// import { installOAuthTokens } from '../cli/handlers/auth.js';
import {
  getSettings_DEPRECATED,
  getSettingsFilePathForSource,
  getSettingsWithSources,
  updateSettingsForSource,
} from '../utils/settings/settings.js';
import { OAuthService } from 'src/services/oauth/index.js';
import { clearOAuthTokenCache, installOAuthTokens } from 'src/cli/auth.js';
import { performLogout } from 'src/commands/logout/logout.js';
import { clearOpenAIClientCache } from 'src/services/api/openai/client.js';
import { setClipboard } from '../ink/termio/osc.js';
import { getGlobalConfig } from '../utils/config.js';
import { useSetAppState } from '../state/AppState.js';

type Props = {
  onDone(): void;
  onCancel?(): void;
  onSettingsChanged?(): void;
  startingMessage?: string;
  mode?: 'login' | 'setup-token';
  forceLoginMethod?: 'claudeai' | 'console';
};

type ProviderId = 'anthropic' | 'openai';
type FieldId = 'baseUrl' | 'apiKey' | 'model';

type OAuthState =
  | { state: 'select_method' }
  | { state: 'waiting_for_login'; url: string } // Browser opened, waiting for user to login
  | { state: 'account_login' }
  | { state: 'switching_to_third_party' }
  | { state: 'select_platform' }
  | { state: 'edit_settings' }
  | {
      state: 'third_party_api';
      provider: ProviderId;
      activeField: FieldId;
      baseUrl: string;
      apiKey: string;
      model: string;
    }
  | { state: 'success'; message?: string }
  | { state: 'error'; message: string; retry?: OAuthState };

const FIELD_ORDER: FieldId[] = ['baseUrl', 'apiKey', 'model'];
// Keep every login sub-view the same height. The command is rendered at the
// tail of the main-screen scrollback, where a grow/shrink transition can push
// old rows outside the writable viewport and leave a visual residue.
const FLOW_MIN_HEIGHT = 6;
const THIRD_PARTY_ENV_KEYS = [
  'Provider',
  'AUTH_TOKEN',
  'BASE_URL',
  'MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
] as const;

type SelectItem<T extends string> = {
  label: string;
  value: T;
};

const PROVIDERS: Record<
  ProviderId,
  {
    title: string;
    description: string;
    modelType: 'anthropic' | 'openai';
    defaultBaseUrl?: string;
    envNames: {
      apiKey: string;
      baseUrl: string;
      model: string;
    };
  }
> = {
  anthropic: {
    title: 'Anthropic',
    description: 'API key, base URL, model.',
    modelType: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    envNames: {
      apiKey: 'ANTHROPIC_AUTH_TOKEN',
      baseUrl: 'ANTHROPIC_BASE_URL',
      model: 'ANTHROPIC_MODEL',
    },
  },
  openai: {
    title: 'OpenAI',
    description: 'API key, base URL, model.',
    modelType: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    envNames: {
      apiKey: 'OPENAI_API_KEY',
      baseUrl: 'OPENAI_BASE_URL',
      model: 'OPENAI_MODEL',
    },
  },
};

function buildThirdPartyEnvironment(
  provider: ProviderId,
  values: { baseUrl: string; apiKey: string; model: string },
): Record<string, string | undefined> {
  const baseUrl = values.baseUrl.trim();
  const apiKey = values.apiKey.trim();
  const model = values.model.trim();

  return {
    // queryModelWithStreaming dispatches directly on this value. Keep it in
    // settings as well as process.env so the next process starts identically.
    Provider: provider,
    AUTH_TOKEN: apiKey,
    BASE_URL: baseUrl || undefined,
    MODEL: model,
    OPENAI_API_KEY:
      provider === 'openai' ? apiKey : undefined,
    OPENAI_BASE_URL:
      provider === 'openai' ? baseUrl || undefined : undefined,
    OPENAI_MODEL: provider === 'openai' ? model : undefined,
    ANTHROPIC_AUTH_TOKEN:
      provider === 'anthropic' ? apiKey : undefined,
    ANTHROPIC_BASE_URL:
      provider === 'anthropic' ? baseUrl || undefined : undefined,
    ANTHROPIC_MODEL: provider === 'anthropic' ? model : undefined,
  };
}

function applyThirdPartyEnvironment(
  environment: Record<string, string | undefined>,
): void {
  // Settings were loaded once during startup. Remove stale values from the
  // previous provider before applying the newly saved provider at runtime.
  for (const key of THIRD_PARTY_ENV_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  // The OpenAI SDK client holds base URL and API key at construction time.
  // Without this, a saved switch only takes effect after restarting the CLI.
  clearOpenAIClientCache();
}

function refreshThirdPartyEnvironmentFromSettings(): void {
  // The editor modifies the file outside updateSettingsForSource(), so bypass
  // the session cache before reading the newly saved configuration.
  const settings = getSettingsWithSources().effective;
  const settingsEnv = settings.env as Record<string, string | undefined> | undefined;
  const provider = (
    settingsEnv?.Provider ?? settings.modelType
  )?.toLowerCase();

  if (provider !== 'openai' && provider !== 'anthropic') {
    return;
  }

  const environment: Record<string, string | undefined> = {};
  for (const key of THIRD_PARTY_ENV_KEYS) {
    environment[key] = settingsEnv?.[key];
  }

  const config = PROVIDERS[provider];
  environment.Provider = provider;
  environment.AUTH_TOKEN ??= settingsEnv?.[config.envNames.apiKey];
  environment.BASE_URL ??= settingsEnv?.[config.envNames.baseUrl];
  environment.MODEL ??= settingsEnv?.[config.envNames.model] ?? settings.model;
  environment[config.envNames.apiKey] ??= environment.AUTH_TOKEN;
  environment[config.envNames.baseUrl] ??= environment.BASE_URL;
  environment[config.envNames.model] ??= environment.MODEL;

  applyThirdPartyEnvironment(environment);
}

function initialProviderState(provider: ProviderId): OAuthState {
  const config = PROVIDERS[provider];
  return {
    state: 'third_party_api',
    provider,
    activeField: 'baseUrl',
    baseUrl: process.env[config.envNames.baseUrl] ?? process.env.BASE_URL ?? config.defaultBaseUrl ?? '',
    apiKey: process.env[config.envNames.apiKey] ?? process.env.AUTH_TOKEN ?? '',
    model: process.env[config.envNames.model] ?? process.env.MODEL ?? '',
  };
}

export function ConsoleOAuthFlow({
  onDone,
  onCancel,
  onSettingsChanged,
  startingMessage,
  mode = 'login',
  forceLoginMethod: forceLoginMethodProp,
}: Props): React.ReactNode {
  const forceLoginMethod = forceLoginMethodProp;
  const settings = getSettings_DEPRECATED() || {};
  const [oAuthState, setOAuthState] = useState<OAuthState>({ state: 'select_method' });
  const [oauthService] = useState(() => new OAuthService());
  const [showPastePrompt, setShowPastePrompt] = useState(false);
  const setAppState = useSetAppState();
  const [loginWithClaudeAi] = useState(
    () => mode === 'setup-token' || forceLoginMethod === 'claudeai',
  );
  const orgUUID = settings.forceLoginOrgUUID;
  const startOAuth = useCallback(async () => {
    try {
      const result = await oauthService
        .startOAuthFlow(
          async url => {
            setOAuthState({ state: 'waiting_for_login', url });
            setShowPastePrompt(false);
            setTimeout(() => setShowPastePrompt(true), 3000);
          },
          {
            loginWithClaudeAi,
            inferenceOnly: mode === 'setup-token',
            expiresIn: mode === 'setup-token' ? 365 * 24 * 60 * 60 : undefined, // 1 year for setup-token
          },
        )
        .catch(err => {
          const isTokenExchangeError = err.message.includes('Token exchange failed');
          // Enterprise TLS proxies (Zscaler et al.) intercept the token
          // exchange POST and cause cryptic SSL errors. Surface an
          // actionable hint so the user isn't stuck in a login loop.
          setOAuthState({
            state: 'error',
            message: isTokenExchangeError
                ? 'Failed to exchange authorization code for access token. Please try again.'
                : err.message,
          });

          throw err;
        });

        await installOAuthTokens(result);
        const account = getGlobalConfig().oauthAccount;
        const initialModel =
          account?.selectedModel ?? account?.availableModels?.[0];
        if (initialModel) {
          setAppState(prev => ({ ...prev, mainLoopModel: initialModel }));
        }
        // Reset modelType to anthropic when using OAuth login
        updateSettingsForSource('userSettings', { modelType: 'anthropic' } as any);

        setOAuthState({ state: 'success', message: 'Login successful.' });

    } catch (err) {
      const errorMessage = (err as Error).message;
      setOAuthState({
        state: 'error',
        message: errorMessage,
        retry: {
          state: 'account_login',
        },
      });

    }
  }, [oauthService, loginWithClaudeAi, mode, setAppState]);
  const switchToThirdParty = useCallback(async () => {
    setOAuthState({ state: 'switching_to_third_party' });
    try {
      // Third-party credentials must never coexist with a cached Claude OAuth
      // session: queryModelWithStreaming would otherwise keep using Efrex.
      await performLogout({ clearOnboarding: false });
      clearOAuthTokenCache();
      setOAuthState({ state: 'select_platform' });
    } catch (error) {
      setOAuthState({
        state: 'error',
        message: `Failed to log out before switching provider: ${
          error instanceof Error ? error.message : String(error)
        }`,
        retry: { state: 'select_method' },
      });
    }
  }, []);
  const pendingOAuthStartRef = useRef(false);
  useEffect(() => {
    if (oAuthState.state === 'account_login') {
      pendingOAuthStartRef.current = true;
      // Start OAuth flow and reset the pending flag when complete
      void startOAuth().finally(() => {
        pendingOAuthStartRef.current = false;
      });
    }
  }, [oAuthState.state, startOAuth]);
  const handleSubmitCode = useCallback(
    (value: string, url: string) => {
      const [authorizationCode, state] = value.trim().split('#');
      if (!authorizationCode || !state) {
        setOAuthState({
          state: 'error',
          message: 'Invalid code. Please paste the complete code.',
          retry: { state: 'waiting_for_login', url },
        });
        return;
      }

      oauthService.handleManualAuthCodeInput({
        authorizationCode,
        state,
      });
    },
    [oauthService],
  );
  useInput((input, key) => {
    if (
      oAuthState.state === 'success' &&
      (key.return || input === '\r' || input === '\n')
    ) {
      onDone();
      return;
    }
    if (oAuthState.state === 'error' && key.return && oAuthState.retry) {
      setOAuthState(oAuthState.retry);
      return;
    }
    if (key.escape) {
      if (oAuthState.state === 'select_method') {
        onCancel?.();
        return;
      }
      if (oAuthState.state === 'select_platform') {
        setOAuthState({ state: 'select_method' });
        return;
      }
      if (oAuthState.state === 'third_party_api' || oAuthState.state === 'edit_settings') {
        setOAuthState({ state: 'select_platform' });
        return;
      }
      if (
        oAuthState.state === 'account_login' ||
        oAuthState.state === 'waiting_for_login' ||
        oAuthState.state === 'error'
      ) {
        setOAuthState({ state: 'select_method' });
      }
    }
  });

  return (
    <Box flexDirection="column" minHeight={FLOW_MIN_HEIGHT} paddingLeft={1}>
      {oAuthState.state === 'select_method' ? (
        <LoginMethodSelect
          startingMessage={startingMessage}
          onAccountLogin={() => setOAuthState({ state: 'account_login' })}
          onThirdParty={() => void switchToThirdParty()}
        />
      ) : null}

      {oAuthState.state === 'account_login' ? <AccountLoginPlaceholder /> : null}

      {oAuthState.state === 'switching_to_third_party' ? (
        <SwitchingToThirdPartyView />
      ) : null}

      {oAuthState.state === 'waiting_for_login' && showPastePrompt ? (
        <WaitingForLoginView
          url={oAuthState.url}
          onSubmit={value => handleSubmitCode(value, oAuthState.url)}
        />
      ) : null}

      {oAuthState.state === 'select_platform' ? (
        <PlatformSelect
          onApiPlatform={provider => setOAuthState(initialProviderState(provider))}
          onEditSettings={() => setOAuthState({ state: 'edit_settings' })}
        />
      ) : null}

      {oAuthState.state === 'edit_settings' ? (
        <EditSettingsView
          onDone={() => setOAuthState({ state: 'select_platform' })}
          onSettingsChanged={onSettingsChanged}
        />
      ) : null}

      {oAuthState.state === 'third_party_api' ? (
        <ThirdPartyApiForm
          flow={oAuthState}
          onChange={setOAuthState}
          onSaved={message => setOAuthState({ state: 'success', message })}
          onError={(message, retry) => setOAuthState({ state: 'error', message, retry })}
        />
      ) : null}

      {oAuthState.state === 'success' ? (
        <SuccessView
          message={oAuthState.message ?? 'Success.'}
          onDone={onDone}
        />
      ) : null}

      {oAuthState.state === 'error' ? <ErrorView message={oAuthState.message} retry={Boolean(oAuthState.retry)} /> : null}
    </Box>
  );
}

function WaitingForLoginView({
  url,
  onSubmit,
}: {
  url: string;
  onSubmit: (value: string) => void;
}): React.ReactNode {
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (value !== 'c') return;
    void setClipboard(url).then(() => {
      setCopied(true);
      setValue('');
      setTimeout(() => setCopied(false), 2000);
    });
  }, [url, value]);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text dimColor>
        Browser didn&apos;t open? {copied ? 'Copied.' : 'Press c to copy the login URL.'}
      </Text>
      <Text color="ansi:blueBright" wrap="truncate-end">
        {url}
      </Text>
    </Box>
  );
}

function LoginMethodSelect({
  startingMessage,
  onAccountLogin,
  onThirdParty,
}: {
  startingMessage?: string;
  onAccountLogin: () => void;
  onThirdParty: () => void;
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Box>

        <Text bold color="ansi:whiteBright">
          {startingMessage ?? 'Choose authentication method'}
        </Text>
      </Box>
      <LocalSelect
        items={[
          {
            label: 'Efrex Code account login',
            value: 'account_login',
          },
          {
            label: '3rd-party platform - OpenAI, Anthropic',
            value: 'third_party',
          },
        ]}
        onSelect={item => {
          if (item.value === 'account_login') {
            onAccountLogin();
            return;
          }
          onThirdParty();
        }}
      />
    </Box>
  );
}

function PlatformSelect({
  onApiPlatform,
  onEditSettings,
}: {
  onApiPlatform: (provider: ProviderId) => void;
  onEditSettings: () => void;
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold color="ansi:greenBright">3rd-party platform</Text>
      <LocalSelect
        items={[
          {
            label: 'OpenAI compatible API',
            value: 'openai',
          },
          {
            label: 'Anthropic compatible API',
            value: 'anthropic',
          },
          {
            label: 'Edit ~/.efrex/settings.json',
            value: 'edit_settings',
          },
        ]}
        onSelect={item => {
          if (item.value === 'edit_settings') {
            onEditSettings();
            return;
          }
          onApiPlatform(item.value);
        }}
      />
    </Box>
  );
}

function LocalSelect<T extends string>({
  items,
  onSelect,
}: {
  items: SelectItem<T>[];
  onSelect: (item: SelectItem<T>) => void;
}): React.ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex(index => (index === 0 ? items.length - 1 : index - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(index => (index === items.length - 1 ? 0 : index + 1));
      return;
    }

    if (key.return) {
      const item = items[selectedIndex];
      if (item) {
        onSelect(item);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, index) => (
        <SelectRow
          key={item.value}
          label={item.label}
          isSelected={index === selectedIndex}
        />
      ))}
    </Box>
  );
}

function SelectRow({
  isSelected,
  label,
}: {
  isSelected: boolean;
  label: string;
}): React.ReactNode {
  const textColor = isSelected ? 'ansi:magentaBright' : undefined;

  return (
    <Box paddingLeft={2}>
      <Text color={isSelected ? 'ansi:magentaBright' : 'ansi:blueBright'} bold={isSelected}>
        {isSelected ? '❯ ' : '  '}
      </Text>
      <Text color={textColor} bold={isSelected}>
        {label}
      </Text>
    </Box>
  );
}

function EditSettingsView({
  onDone,
  onSettingsChanged,
}: {
  onDone: () => void;
  onSettingsChanged?: () => void;
}): React.ReactNode {
  const { setRawMode } = useStdin();
  const [status, setStatus] = useState('Opening ~/.efrex/settings.json...');
  const hasOpenedEditor = useRef(false);

  useEffect(() => {
    if (hasOpenedEditor.current) {
      return;
    }
    hasOpenedEditor.current = true;

    const settingsPath = getSettingsFilePathForSource('userSettings');
    if (!settingsPath) {
      setStatus('Unable to resolve the user settings path. Press Esc to go back.');
      return;
    }

    try {
      mkdirSync(dirname(settingsPath), { recursive: true });
      if (!existsSync(settingsPath)) {
        writeFileSync(settingsPath, '{}\n', 'utf8');
      }

      const editor =
        process.env.VISUAL ||
        process.env.EDITOR ||
        (process.platform === 'win32' ? 'notepad' : 'vi');

      setRawMode(false);
      const result = spawnSync(editor, [settingsPath], {
        stdio: 'inherit',
        shell: true,
      });
      setRawMode(true);

      if (result.error) {
        setStatus(`Could not open editor: ${result.error.message}`);
      } else if (result.status !== 0) {
        setStatus(`Editor exited with code ${result.status}.`);
      } else {
        refreshThirdPartyEnvironmentFromSettings();
        onSettingsChanged?.();
        setStatus(`Saved ${settingsPath}. Press Enter or Esc to go back.`);
      }
    } catch (error) {
      setRawMode(true);
      setStatus(
        `Could not edit settings: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [onSettingsChanged, setRawMode]);

  useInput((input, key) => {
    if (key.return || key.escape) {
      onDone();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="ansi:greenBright">Edit user settings</Text>
      <Text>{status}</Text>
    </Box>
  );
}

function SwitchingToThirdPartyView(): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold color="ansi:cyanBright">Switching to 3rd-party platform</Text>
      <Text dimColor>Signing out of the Efrex Code account…</Text>
    </Box>
  );
}

function AccountLoginPlaceholder(): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text bold color="ansi:greenBright">Efrex Code account login</Text>
      <Text>Not wired yet.</Text>
      <Text dimColor>Press Esc to go back.</Text>
    </Box>
  );
}

function ThirdPartyApiForm({
  flow,
  onChange,
  onSaved,
  onError,
}: {
  flow: Extract<OAuthState, { state: 'third_party_api' }>;
  onChange: (flow: OAuthState) => void;
  onSaved: (message: string) => void;
  onError: (message: string, retry: OAuthState) => void;
}): React.ReactNode {
  const setAppState = useSetAppState();
  const provider = PROVIDERS[flow.provider];
  const values = useMemo(
    () => ({
      baseUrl: flow.baseUrl,
      apiKey: flow.apiKey,
      model: flow.model,
    }),
    [flow.apiKey, flow.baseUrl, flow.model],
  );
  const [inputValue, setInputValue] = useState(values[flow.activeField]);

  const updateField = (field: FieldId, value: string, activeField = flow.activeField) => {
    onChange({
      ...flow,
      [field]: value,
      activeField,
    });
  };

  const save = () => {
    const finalValues = {
      ...values,
      [flow.activeField]: inputValue.trim(),
    };

    if (!finalValues.apiKey.trim()) {
      onError('API key is required.', {
        ...flow,
        apiKey: finalValues.apiKey,
        activeField: 'apiKey',
      });
      return;
    }

    if (!finalValues.model.trim()) {
      onError('Model name is required.', {
        ...flow,
        model: finalValues.model,
        activeField: 'model',
      });
      return;
    }

    if (finalValues.baseUrl.trim()) {
      try {
        new URL(finalValues.baseUrl.trim());
      } catch {
        onError('Base URL must include protocol, for example https://api.example.com/v1.', {
          ...flow,
          baseUrl: finalValues.baseUrl,
          activeField: 'baseUrl',
        });
        return;
      }
    }

    const env = buildThirdPartyEnvironment(flow.provider, finalValues);

    const { error } = updateSettingsForSource('userSettings', {
      modelType: provider.modelType,
      model: finalValues.model.trim(),
      env,
    } as never);

    if (error) {
      onError(`Failed to save settings: ${error.message}`, flow);
      return;
    }

    applyThirdPartyEnvironment(env);
    setAppState(prev => ({
      ...prev,
      mainLoopModel: finalValues.model.trim(),
    }));
    onSaved(`${provider.title} credentials saved.`);
  };

  const submitField = () => {
    const index = FIELD_ORDER.indexOf(flow.activeField);
    const field = flow.activeField;
    const nextField = FIELD_ORDER[index + 1];

    if (!nextField) {
      updateField(field, inputValue);
      save();
      return;
    }

    updateField(field, inputValue, nextField);
    setInputValue(values[nextField]);
  };

  const renderRow = (field: FieldId, label: string, mask = false) => {
    const active = field === flow.activeField;
    const value = active ? inputValue : values[field];
    return (
      <Box>
        <Text color={active ? 'ansi:greenBright' : 'ansi:blueBright'} bold={active}>
          {active ? '❯' : ' '}
          {' '}
        </Text>
        <Text color={active ? 'ansi:whiteBright' : 'ansi:cyanBright'} bold={active}>
          {label.padEnd(8)}
        </Text>
        <Text> </Text>
        {active ? (
          <EfrexTextInput
            key={field}
            value={inputValue}
            onChange={setInputValue}
            onSubmit={submitField}
            mask={mask ? '*' : undefined}
          />
        ) : value ? (
          <Text color="ansi:greenBright">{mask ? maskSecret(value) : value}</Text>
        ) : (
          <Text dimColor>{field === 'baseUrl' ? '(optional)' : '(empty)'}</Text>
        )}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      <Text bold color="ansi:greenBright">
        {provider.title} setup
      </Text>
      <Text color="ansi:blueBright">{provider.description}</Text>
      <Box flexDirection="column">
        {renderRow('baseUrl', 'Base URL', false)}
        {renderRow('apiKey', 'API Key ', true)}
        {renderRow('model', 'Model   ', false)}
      </Box>
      <Text dimColor>Enter next/save, Esc back</Text>
    </Box>
  );
}

function EfrexTextInput({
  value,
  onChange,
  onSubmit,
  mask,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  mask?: string;
}): React.ReactNode {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    setCursorOffset(offset => Math.min(offset, value.length));
  }, [value]);

  useInput((input, key, event) => {
    // Let the parent flow handle navigation and Ctrl+C cancellation.
    if (key.escape || (key.ctrl && input.toLowerCase() === 'c')) {
      return;
    }

    if (key.return) {
      event.stopImmediatePropagation();
      onSubmit(value);
      return;
    }

    let nextOffset = cursorOffset;
    let nextValue = value;

    if (key.leftArrow || key.ctrl && input === 'b') {
      nextOffset = Math.max(0, cursorOffset - 1);
    } else if (key.rightArrow || key.ctrl && input === 'f') {
      nextOffset = Math.min(value.length, cursorOffset + 1);
    } else if (key.home || key.ctrl && input === 'a') {
      nextOffset = 0;
    } else if (key.end || key.ctrl && input === 'e') {
      nextOffset = value.length;
    } else if (key.backspace || key.ctrl && input === 'h') {
      if (cursorOffset > 0) {
        nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
        nextOffset -= 1;
      }
    } else if (key.delete || key.ctrl && input === 'd') {
      nextValue = value.slice(0, cursorOffset) + value.slice(cursorOffset + 1);
    } else if (!key.ctrl && !key.meta && !key.escape && input) {
      nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
      nextOffset += input.length;
    } else {
      return;
    }

    event.stopImmediatePropagation();
    setCursorOffset(nextOffset);
    if (nextValue !== value) {
      onChange(nextValue);
    }
  });

  const visibleValue = mask ? mask.repeat(value.length) : value;
  const cursor = visibleValue[cursorOffset] ?? ' ';

  return (
    <Text>
      {visibleValue.slice(0, cursorOffset)}
      <Text inverse>{cursor}</Text>
      {visibleValue.slice(cursorOffset + (cursorOffset < visibleValue.length ? 1 : 0))}
    </Text>
  );
}

function SuccessView({
  message,
  onDone,
}: {
  message: string;
  onDone(): void;
}): React.ReactNode {
  useInput(
    (input, key, event) => {
      if (key.return || input === '\r' || input === '\n') {
        event.stopImmediatePropagation();
        onDone();
      }
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column">
      <Text color="ansi:greenBright">{message}</Text>
      <Text dimColor>Press Enter to continue.</Text>
    </Box>
  );
}

function ErrorView({
  message,
  retry,
}: {
  message: string;
  retry: boolean;
}): React.ReactNode {
  return (
    <Box flexDirection="column">
      <Text color="ansi:redBright">Platform setup error: {message}</Text>
      <Text dimColor>
        {retry ? 'Press Enter to retry, or Esc to go back.' : 'Press Esc to go back.'}
      </Text>
    </Box>
  );
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 8, 24))}${value.slice(-4)}`;
}
