import { cwd as getProcessCwd } from 'node:process'
import { setCwdState, setOriginalCwd, setProjectRoot } from './bootstrap/state'

export function setup() {
  const cwd = getProcessCwd()
  setCwdState(cwd)
  setOriginalCwd(cwd)
  setProjectRoot(cwd)
}
