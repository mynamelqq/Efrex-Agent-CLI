import chalk from 'chalk';
import * as path from 'path';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logEvent } from 'src/services/analytics/index.js';
import type { CommandResultDisplay, LocalJSXCommandContext } from '../../commands.js';
import { Select } from '../../components/CustomSelect/index.js';
import { Dialog } from '@anthropic/ink';
import {
  IdeAutoConnectDialog,
  IdeDisableAutoConnectDialog,
  shouldShowAutoConnectDialog,
  shouldShowDisableAutoConnectDialog,
} from '../../components/IdeAutoConnectDialog.js';
import { Box, Text } from '@anthropic/ink';
import { clearServerCache } from '../../services/mcp/client.js';
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getCwd } from '../../utils/cwd.js';
import { execFileNoThrow } from '../../utils/execFileNoThrow.js';
import {
  type DetectedIDEInfo,
  detectIDEs,
  detectRunningIDEs,
  type IdeType,
  isJetBrainsIde,
  isSupportedJetBrainsTerminal,
  isSupportedTerminal,
  toIDEDisplayName,
} from '../../utils/ide.js';





async function findCurrentIDE(
  availableIDEs: DetectedIDEInfo[],
  dynamicMcpConfig?: Record<string, ScopedMcpServerConfig>,
): Promise<DetectedIDEInfo | null> {
  const currentConfig = dynamicMcpConfig?.ide;
  if (!currentConfig || (currentConfig.type !== 'sse-ide' && currentConfig.type !== 'ws-ide')) {
    return null;
  }
  for (const ide of availableIDEs) {
    if (ide.url === currentConfig.url) {
      return ide;
    }
  }
  return null;
}