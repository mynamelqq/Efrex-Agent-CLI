import { Text } from "src/ink";
import { removeApiKey } from "src/utils/auth";
import { saveGlobalConfig } from "src/utils/config";
import { gracefulShutdownSync } from "src/utils/gracefulShutdown";
import { getSecureStorage } from "src/utils/secureStorage";
import { clearToolSchemaCache } from "src/utils/toolSchemaCache";


export async function performLogout({ clearOnboarding = false }): Promise<void> {

  await removeApiKey();

  // Wipe all secure storage data on logout
  const secureStorage = getSecureStorage();//.credentials.json存到这个文件
  secureStorage.delete();

  await clearAuthRelatedCaches();
  saveGlobalConfig(current => {
    const updated = { ...current };
    if (clearOnboarding) {
      updated.hasCompletedOnboarding = false;
      updated.subscriptionNoticeCount = 0;
      updated.hasAvailableSubscription = false;
      if (updated.customApiKeyResponses?.approved) {
        updated.customApiKeyResponses = {
          ...updated.customApiKeyResponses,
          approved: [],
        };
      }
    }
    updated.oauthAccount = undefined;
    return updated;
  });
}
// clearing anything memoized that must be invalidated when user/session/auth changes
export async function clearAuthRelatedCaches(): Promise<void> {//清楚与登录认证相关的缓存
  // Clear the OAuth token cache
//   getClaudeAIOAuthTokens.cache?.clear?.();
//   clearTrustedDeviceTokenCache();
//   clearBetasCaches();
  clearToolSchemaCache();

  // Clear user data cache BEFORE GrowthBook refresh so it picks up fresh credentials
//   resetUserCache();


  // Clear Grove config cache
//   getGroveNoticeConfig.cache?.clear?.();
//   getGroveSettings.cache?.clear?.();

  // Clear remotely managed settings cache
//   await clearRemoteManagedSettingsCache();

  // Clear policy limits cache
//   await clearPolicyLimitsCache();
}
export async function call(): Promise<React.ReactNode> {
  await performLogout({ clearOnboarding: true });

  const message = <Text>Successfully logged out from your Anthropic account.</Text>;

  setTimeout(() => {
    gracefulShutdownSync(0, 'logout');

    // Keep the original graceful shutdown path, but do not leave the REPL
    // alive if terminal cleanup or a registered cleanup task hangs.
    setTimeout(() => {
      process.exit(0);
    }, 800);
  }, 200);

  return message;
}
