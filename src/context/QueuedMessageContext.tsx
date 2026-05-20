import * as React from 'react';
import { Box } from '../ink.js';

type QueuedMessageContextValue = {
	isQueued: boolean;
	isFirst: boolean;
	paddingWidth: number;
};

const QueuedMessageContext = React.createContext<
	QueuedMessageContextValue | undefined
>(undefined);

export function useQueuedMessage():
	| QueuedMessageContextValue
	| undefined {
	return React.useContext(QueuedMessageContext);
}

type Props = {
	isFirst: boolean;
	paddingX?: number;
	children: React.ReactNode;
};

export function QueuedMessageProvider({
	isFirst,
	paddingX = 1,
	children
}: Props): React.ReactNode {
	const value = React.useMemo(
		() => ({
			isQueued: true,
			isFirst,
			paddingWidth: paddingX * 2
		}),
		[isFirst, paddingX]
	);

	return (
		<QueuedMessageContext.Provider value={value}>
			<Box paddingX={paddingX}>{children}</Box>
		</QueuedMessageContext.Provider>
	);
}
