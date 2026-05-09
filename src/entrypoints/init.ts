import { memoize } from "lodash"
import { applySafeConfigEnvironmentVariables } from "../utils/settings/settings"
export const init = memoize(async (): Promise<void> => {
    const initStartTime = Date.now()
    applySafeConfigEnvironmentVariables()



})