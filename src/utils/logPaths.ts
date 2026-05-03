import { homedir } from 'os'
import { join } from 'path'

const EFREX_DIR = join(homedir(), '.efrex')

export const LOG_PATHS = {
  logs: () => join(EFREX_DIR, 'logs'),
  errors: () => join(EFREX_DIR, 'errors'),
  debug: () => join(EFREX_DIR, 'debug'),
}

export function dateToFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}
