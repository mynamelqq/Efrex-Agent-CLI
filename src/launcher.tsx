import React from 'react'
import { Box, Text, useApp, useInput } from './ink.js'
import QueryApp from './QueryApp.js'
import { isWorkSpaceTruested, trustFoler } from '../utils/load.js'
import { Props as queryAppProps } from './QueryApp.js'
import { EBP, DBP } from './ink/termio/dec.js'
import { AppStateProvider } from './state/AppState.js'
import { AppState } from './state/AppState.js'
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
type AppWrapperProps = {
  initialState: AppState;
};
type LauncherProps = AppWrapperProps & queryAppProps;
export default function Launcher(props: LauncherProps) {
  const { initialState, ...replProps } = props;
  const [trusted, setTrusted] = React.useState(isWorkSpaceTruested())
  React.useEffect(() => {
    // Enable bracketed paste mode
    process.stdout.write(EBP)
    return () => {
      // Disable bracketed paste mode
      process.stdout.write(DBP)
    }
  }, [])
  if (!trusted) {
    return <TrustPrompt onTrust={() => setTrusted(true)} />
  }

  return (
    <AppStateProvider initialState={initialState}>
      <QueryApp
        {...replProps}  >
      </QueryApp>    
    </AppStateProvider>
  )
}
