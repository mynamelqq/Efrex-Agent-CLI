import { memoize } from 'lodash'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applySafeConfigEnvironmentVariables } from '../utils/settings/settings'


export const init = memoize(async (): Promise<void> => {
  const initStartTime = Date.now()
  applySafeConfigEnvironmentVariables()



})
