#!/usr/bin/env node

/**
 * ChatUI-Cli
 * a terminal agent developed by YaQi Li(Efrewew)
 *
 * @author Yaqi Li <github.com/mynamelqq>
 */

import React from 'react';
import path from 'node:path';
import App from './app.js';
import { homedir } from 'node:os';
import {Box, Text, render, useApp, useInput} from 'ink';
import { isWorkSpaceTruested, trustFoler } from './utils/load.js';
import { existsSync, mkdirSync } from 'node:fs';

const TrustPrompt = ({onTrust}: {onTrust: () => void}) => {
  const {exit} = useApp();
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const options = [
    {label: '信任此工作目录', value: 'trust'},
    {label: '不信任并退出', value: 'reject'},
  ];

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) {
      setSelectedIndex(index => (index === 0 ? 1 : 0));
      return;
    }

    if (key.return) {
      if (options[selectedIndex]?.value === 'trust') {
        trustFoler();
        onTrust();
      } else {
        exit();
      }
      return;
    }

    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyanBright">Efrex 工作目录信任确认</Text>
      <Box marginTop={1}>
        <Text dimColor>当前目录: {process.cwd()}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {options.map((option, index) => {
          const selected = index === selectedIndex;
          return (
            <Box key={option.value}>
              <Text color={selected ? 'greenBright' : 'gray'}>
                {selected ? '› ' : '  '}
              </Text>
              <Text color={selected ? 'greenBright' : undefined}>
                {option.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ 选择 · Enter 确认 · Ctrl+C 退出</Text>
      </Box>
    </Box>
  );
};

const Root = () => {
  const [trusted, setTrusted] = React.useState(isWorkSpaceTruested());

  if (!trusted) {
    return <TrustPrompt onTrust={() => setTrusted(true)} />;
  }

  return <App />;
};

(async () => {
  const efrexFolder=path.join(homedir(),".efrex")
  if(!existsSync(efrexFolder)){
    mkdirSync(efrexFolder, { recursive: true });
  }
  process.stdout.write('\u001b[2J\u001b[H');
  render(<Root />, {
    exitOnCtrlC: false,
    alternateScreen: false,
  });
})();
