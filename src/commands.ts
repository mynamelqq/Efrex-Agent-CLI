import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface CommandResult {
  success: boolean;
  message: string;
  shouldContinueChat?: boolean;
}

async function updateSetting(key: string, value: string): Promise<void> {
  const settingPath = path.join(homedir(),"/.efrex", 'setting.json');
  const content = await fs.readFile(settingPath, 'utf-8');
  const settings = JSON.parse(content);
  if (!settings.env) {
    settings.env = {};
  }
  settings.env[key] = value;
  await fs.writeFile(settingPath, JSON.stringify(settings, null, 2));
}

export async function handleModelCommand(args: string): Promise<CommandResult> {
  const modelName = args.trim();
  if (!modelName) {
    return {
      success: false,
      message: '请指定模型名称，例如: /model glm-5.1',
    };
  }

  try {
    await updateSetting('MODEL', modelName);
    // Clear the settings loaded flag so that queryDemo.ts will reload.
    const { resetSettings } = await import('./queryDemo.js');
    resetSettings();
    return {
      success: true,
      message: `模型已切换到: ${modelName}`,
      shouldContinueChat: false,
    };
  } catch (error) {
    return {
      success: false,
      message: `切换模型失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function parseCommand(input: string): Promise<CommandResult | null> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parts = trimmed.slice(1).split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (command) {
    case 'model':
      return await handleModelCommand(args);
    case 'help':
      return {
        success: true,
        message: '可用命令:\n  /model <name>  - 切换模型\n  /help          - 显示帮助',
        shouldContinueChat: false,
      };
    default:
      return null;
  }
}
