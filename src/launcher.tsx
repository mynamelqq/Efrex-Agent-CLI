import React from 'react'
import { Box, Text, useApp, useInput } from './ink.js'
import QueryApp from './QueryApp.js'
import { isWorkSpaceTruested, trustFoler } from '../utils/load.js'
import { getAllBaseTools } from './tools.js'
import { init } from './entrypoints/init.js'

import { EBP, DBP } from './ink/termio/dec.js'
import { getGlobalConfig } from './utils/config.js'
import { getCommands } from './commands.js'
import { AppStateProvider } from './state/AppState.js'
import { AppState } from './state/AppState.js'
import { getInitialSettings } from './utils/settings/settings.js'
import { getInitialEffortSetting } from './utils/effort.js'
import { shouldEnableThinkingByDefault } from './utils/thinking.js'
import { getInitialMainLoopModel } from './bootstrap/state.js'
import { getEmptyToolPermissionContext } from './Tool.js'
function TrustPrompt({ onTrust }: { onTrust: () => void }) {
  const { exit } = useApp()
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const options = [
    { label: '信任此工作目录', value: 'trust' },
    { label: '不信任并退出', value: 'reject' },
  ]

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) {
      setSelectedIndex(index => (index === 0 ? 1 : 0))
      return
    }

    if (key.return) {
      if (options[selectedIndex]?.value === 'trust') {
        trustFoler()
        onTrust()
      } else {
        exit()
      }
      return
    }

    if (key.ctrl && input === 'c') {
      exit()
    }
  })

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyanBright">Efrex 工作目录信任确认</Text>
      <Box marginTop={1}>
        <Text dimColor>当前目录: {process.cwd()}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {options.map((option, index) => {
          const selected = index === selectedIndex
          return (
            <Box key={option.value}>
              <Text color={selected ? 'greenBright' : 'gray'}>
                {selected ? '› ' : '  '}
              </Text>
              <Text color={selected ? 'greenBright' : undefined}>
                {option.label}
              </Text>
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ 选择 · Enter 确认 · Ctrl+C 退出</Text>
      </Box>
    </Box>
  )
}

export default function Launcher() {
  const [trusted, setTrusted] = React.useState(isWorkSpaceTruested())
  const [commands, setCommands] = React.useState<Awaited<ReturnType<typeof getCommands>> | null>(null)
  process.env.NODE_ENV="test"
  const thinkingEnabled=shouldEnableThinkingByDefault()
  const initialState: AppState = {
      settings: getInitialSettings(),
      mainLoopModel: process.env.MODEL as string,
      toolPermissionContext: getEmptyToolPermissionContext(),
      fileHistory: {
        snapshots: [],
        trackedFiles: new Set(),
        snapshotSequence: 0,
      },
      inbox: {
        messages: [],
      },
      effortValue: getInitialEffortSetting(),
    };
  React.useEffect(() => {
    // Enable bracketed paste mode
    process.stdout.write(EBP)
    return () => {
      // Disable bracketed paste mode
      process.stdout.write(DBP)
    }
  }, [])

  React.useEffect(() => {
    let mounted = true
    void getCommands().then(result => {
      if (mounted) {
        setCommands(result)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  if (!trusted) {
    return <TrustPrompt onTrust={() => setTrusted(true)} />
  }

  if (!commands) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text dimColor>Loading commands...</Text>
      </Box>
    )
  }

  return (
    <AppStateProvider initialState={initialState}>
      <QueryApp
        debug={false}
        thinkingConfig={{ type: 'adaptive' }}
        initialTools={[]}
        initialMessages={[]}
        commands={commands}
      />
    </AppStateProvider>
  )
}
