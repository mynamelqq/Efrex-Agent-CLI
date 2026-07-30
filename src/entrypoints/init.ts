import { memoize } from 'lodash'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applySafeConfigEnvironmentVariables } from '../utils/settings/settings'
import { initThemeConfig } from '../utils/themeConfig'


export const init = memoize(async (): Promise<void> => {
  const initStartTime = Date.now()
  applySafeConfigEnvironmentVariables()
  initThemeConfig()



})
