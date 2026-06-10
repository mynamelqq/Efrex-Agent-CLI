import React from 'react';
import { Box } from "src/ink.js";
import { BashTool } from "src/tools/BashTool/BashTool.js";
import type { ShellProgress } from 'src/tools.js';
import { UserBashInputMessage } from './messages/UserBashInputMessage';
import { ShellProgressMessage } from './shell/ShellProgressMessage.js';

type Props = {
  input: string;
  progress: ShellProgress | null;
  verbose: boolean;
};

export function BashModeProgress({ input, progress, verbose }: Props): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      <UserBashInputMessage addMargin={false} param={{ text: `<bash-input>${input}</bash-input>`, type: 'text' }} />
      {progress ? (
        <ShellProgressMessage
          fullOutput={progress.fullOutput}
          output={progress.output}
          elapsedTimeSeconds={progress.elapsedTimeSeconds}
          totalLines={progress.totalLines}
          verbose={verbose}
        />
      ) : (
        BashTool.renderToolUseProgressMessage?.([], {
          verbose,
          tools: [],
          terminalSize: undefined,
        })
      )}
    </Box>
  );
}
