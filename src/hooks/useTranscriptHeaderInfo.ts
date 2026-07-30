import { useAppState } from '../state/AppState.js';
import { getEffortLevel } from '../utils/anthropicConfig.js';

function truncate(value: string, maxLen: number): string {
	if (value.length <= maxLen) return value;
	return value.slice(0, maxLen - 1) + '…';
}

export function useTranscriptHeaderInfo(maxModelLen = 36, maxEffortLen = 12) {
	const model = useAppState(s => s.mainLoopModel);
	const effort = getEffortLevel();

	return {
		model: truncate(model, maxModelLen),
		effort: truncate(effort || 'medium', maxEffortLen),
	};
}
