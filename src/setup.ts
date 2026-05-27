import { cwd as getProcessCwd } from 'node:process'
import { setCwdState, setOriginalCwd, setProjectRoot } from './bootstrap/state'

export async function setup(cwd:string):Promise<void> {
  setCwdState(cwd)
  setOriginalCwd(cwd)
  setProjectRoot(cwd)
}
