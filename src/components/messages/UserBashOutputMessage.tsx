import * as React from 'react';
import { ExpandShellOutputProvider } from '../shell/ExpandShellOutputContext.js';
import BashToolResultMessage from 'src/tools/BashTool/BashToolResultMessage.js';
import { extractTag } from '../../utils/messages.js';

export function UserBashOutputMessage({
	content,
	verbose
}: {
	content: string;
	verbose?: boolean;
}): React.ReactNode {
	const rawStdout = extractTag(content, 'bash-stdout') ?? '';
	const stdout = extractTag(rawStdout, 'persisted-output') ?? rawStdout;
	const stderr = extractTag(content, 'bash-stderr') ?? '';

	return (
		<ExpandShellOutputProvider>
			<BashToolResultMessage
				content={{ stdout, stderr }}
				verbose={Boolean(verbose)}
			/>
		</ExpandShellOutputProvider>
	);
}
