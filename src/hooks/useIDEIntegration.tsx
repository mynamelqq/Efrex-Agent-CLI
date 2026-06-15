import { useEffect } from 'react';
import type { ScopedMcpServerConfig } from '../services/mcp/types.js';
import { getGlobalConfig } from '../utils/config.js';
import { isEnvDefinedFalsy, isEnvTruthy } from '../utils/envUtils.js';
import type { DetectedIDEInfo } from '../utils/ide.js';
import {
  type IDEExtensionInstallationStatus,
  type IdeType,
  initializeIdeIntegration,
  isSupportedTerminal,
} from '../utils/ide.js';
import { logMCPDebug } from '../utils/log.js';

type UseIDEIntegrationProps = {
  autoConnectIdeFlag?: boolean;
  ideToInstallExtension: IdeType | null;
  setDynamicMcpConfig: React.Dispatch<React.SetStateAction<Record<string, ScopedMcpServerConfig> | undefined>>;
  setShowIdeOnboarding: React.Dispatch<React.SetStateAction<boolean>>;
  setIDEInstallationState: React.Dispatch<React.SetStateAction<IDEExtensionInstallationStatus | null>>;
};

export function useIDEIntegration({
  autoConnectIdeFlag,
  ideToInstallExtension,
  setDynamicMcpConfig,
  setShowIdeOnboarding,
  setIDEInstallationState,
}: UseIDEIntegrationProps): void {
  useEffect(() => {
    function addIde(ide: DetectedIDEInfo | null) {//检测到ide信息后，调用这个回调 设置appstate daynamicMcp
      if (!ide) {
        return;
      }

      // Check if auto-connect is enabled
      const globalConfig = getGlobalConfig();
      const autoConnectEnabled =
        (globalConfig.autoConnectIde ||
          autoConnectIdeFlag ||
          isSupportedTerminal() ||
          // tmux/screen overwrite TERM_PROGRAM, breaking terminal detection, but the
          // IDE extension's port env var is inherited. If set, auto-connect anyway.
          process.env.SSE_PORT ||
          ideToInstallExtension ||
          isEnvTruthy(process.env.AUTO_CONNECT_IDE)) &&
        !isEnvDefinedFalsy(process.env.AUTO_CONNECT_IDE);

      if (!autoConnectEnabled) {
        return;
      }

      setDynamicMcpConfig(prev => {
        // Only add the IDE if we don't already have one
        if (prev?.ide) {
          return prev;
        }
        return {
          ...prev,
          ide: {
            type: ide.url.startsWith('ws:') ? 'ws-ide' : 'sse-ide',
            url: ide.url,
            ideName: ide.name,
            authToken: ide.authToken,
            ideRunningInWindows: ide.ideRunningInWindows,
            scope: 'dynamic' as const,
          },
        };
      });
    }

    // Use the new utility function
    void initializeIdeIntegration(//读取ide lock配置 加入到appstate中，安装插件
      addIde,
      ideToInstallExtension,
      () => setShowIdeOnboarding(true),
      status => setIDEInstallationState(status),
    );
  }, [autoConnectIdeFlag, ideToInstallExtension, setDynamicMcpConfig, setShowIdeOnboarding, setIDEInstallationState]);
}
