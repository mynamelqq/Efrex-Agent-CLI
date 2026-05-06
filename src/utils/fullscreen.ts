import {isEnvTruthy} from './envUtils.js';

export function isFullscreenEnvEnabled(): boolean {
  return isEnvTruthy(process.env.EFREX_FULLSCREEN);
}

export function isMouseClicksDisabled(): boolean {
  return isEnvTruthy(process.env.EFREX_DISABLE_MOUSE_CLICKS);
}
