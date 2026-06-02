import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js';



export function isFullscreenEnvEnabled(): boolean {
  if (isEnvTruthy(process.env.EFREX_FULLSCREEN)) {
    return true
  }

  if (isEnvDefinedFalsy(process.env.EFREX_FULLSCREEN)) {
    return false
  }

  return false
}

export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(process.env.EFREX_DISABLE_MOUSE_CLICKS);
}
