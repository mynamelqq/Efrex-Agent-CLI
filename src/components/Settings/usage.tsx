import * as React from 'react';
import { useEffect, useState } from 'react';
import { Box, ProgressBar, Text } from '@anthropic/ink';
import { getClaudeAIOAuthTokens } from '../../cli/auth.js';
import { storeOAuthAccountInfo } from '../../services/oauth/client.js';
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js';
import { getOauthAccountInfo } from '../../utils/auth.js';
import type { AccountInfo } from '../../utils/config.js';

type PlanPresentation = {
  label: string;
  token: string;
  description: string;
};

const PLAN_PRESENTATIONS: Record<string, PlanPresentation> = {
  FREE: {
    label: '基础体验 (Free)',
    token: '200 万',
    description: '默认对话、代码解释、简单修改和短任务。',
  },
  LITE: {
    label: '轻量开发者 (Lite)',
    token: '1,500 万',
    description: '低成本运行日常编码与项目分析。',
  },
  PRO: {
    label: '专业构建者 (Pro)',
    token: '3,800 万',
    description: '复杂代码生成、跨文件修改、调试与重构。',
  },
  MAX: {
    label: '深度构建模式 (Max)',
    token: '9,000 万',
    description: '中大型项目、多任务并行与旗舰模型。',
  },
  ULTRA: {
    label: '团队与重度使用 (Ultra)',
    token: '2.0 亿',
    description: '面向高强度 Agent 任务和长期团队协作。',
  },
};

export function getPlanPresentation(plan: AccountInfo['plan']): PlanPresentation | undefined {
  const code = plan?.code?.toUpperCase();
  if (code && PLAN_PRESENTATIONS[code]) return PLAN_PRESENTATIONS[code];
  if (plan?.name) {
    return { label: plan.name, token: '—', description: '当前账户套餐。' };
  }
  return undefined;
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function UsageSummary({ account }: { account: AccountInfo }): React.ReactNode {
  const used = account.usedStandardTokens;
  const remaining = account.remainingStandardTokens;
  if (used === undefined || remaining === undefined) {
    return <Text dimColor>Standard token usage is not available for this account.</Text>;
  }

  const total = used + remaining;
  const ratio = total > 0 ? used / total : 0;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Standard token usage</Text>
      <Box gap={1} alignItems="center">
        <ProgressBar
          ratio={ratio}
          width={30}
          fillColor="rate_limit_fill"
          emptyColor="rate_limit_empty"
        />
        <Text>{Math.round(ratio * 100)}%</Text>
      </Box>
      <Text dimColor>
        {formatTokens(used)} used · {formatTokens(remaining)} remaining
      </Text>
    </Box>
  );
}

export async function refreshAccountProfile(): Promise<boolean> {
  const tokens = getClaudeAIOAuthTokens();
  if (!tokens?.accessToken) return false;

  const profile = await getOauthProfileFromOauthToken(tokens.accessToken);
  if (!profile) return false;

  storeOAuthAccountInfo({
    id: profile.id,
    email: profile.email,
    plan: profile.plan
      ? {
          code: profile.plan.code,
          name: profile.plan.name,
          monthlyPriceCents: profile.plan.monthly_price_cents,
          monthlyStandardTokens: profile.plan.monthly_standard_tokens,
          rpmLimit: profile.plan.rpm_limit,
          periodStart: profile.plan.period_start,
          periodEnd: profile.plan.period_end,
        }
      : undefined,
    usedStandardTokens: profile.used_standard_tokens,
    remainingStandardTokens: profile.remaining_standard_tokens,
    availableModels: profile.available_models,
  });
  return true;
}

export function Usage({ profileRefresh }: { profileRefresh?: Promise<boolean> }): React.ReactNode {
  const [account, setAccount] = useState(() => getOauthAccountInfo());
  const [state, setState] = useState<'loading' | 'synced' | 'cached' | 'logged-out'>('loading');

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      if (!getClaudeAIOAuthTokens()?.accessToken) {
        if (mounted) setState('logged-out');
        return;
      }
      const refreshed = await (profileRefresh ?? refreshAccountProfile());
      if (!mounted) return;
      if (!refreshed) {
        setState('cached');
        return;
      }
      setAccount(getOauthAccountInfo());
      setState('synced');
    };

    void refresh();
    return () => {
      mounted = false;
    };
  }, [profileRefresh]);

  if (state === 'logged-out' || !account) {
    return <Text dimColor>Log in to view account usage.</Text>;
  }

  return (
    <Box flexDirection="column" gap={1} width="100%">
      <Text bold color="permission">Account usage</Text>
      {state === 'loading' ? <Text dimColor>Refreshing from the server…</Text> : null}
      {getPlanPresentation(account.plan) ? (
        <Box flexDirection="column">
          <Text bold>{getPlanPresentation(account.plan)?.label}</Text>
          <Text dimColor>{getPlanPresentation(account.plan)?.description}</Text>
          <Text dimColor>Included standard tokens: {getPlanPresentation(account.plan)?.token}</Text>
        </Box>
      ) : null}
      <UsageSummary account={account} />
      {state === 'synced' ? <Text color="success">Updated from the server.</Text> : null}
      {state === 'cached' ? <Text color="warning">Refresh failed; showing cached data.</Text> : null}
    </Box>
  );
}
