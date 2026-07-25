import React from 'react';
import { Box, Text } from '../ink.js';

const BLUE = '#45a9f5';
const PURPLE = '#9b55e8';

/** The static welcome artwork shown above the onboarding flow. */
export function WelcomeV2(): React.ReactNode {
    return (
        <Box flexDirection="column" alignItems="center" width="100%" paddingX={2}>
            <Text color={PURPLE}>{'·—_                                           _—·'}</Text>
            <Text bold>
                <Text color={BLUE}>{'      █████   █████  ██  ██  █████  ███████'}</Text>
                <Text color={PURPLE}>{' ██  ██    ██████    '}</Text>
            </Text>
            <Text bold>
                <Text color={BLUE}>{'  ✦  ██      ██     ██  ██  ██  ██    ██   '}</Text>
                <Text color={PURPLE}>{' ██  ██  ██      ██  '}</Text>
            </Text>
            <Text bold>
                <Text color={BLUE}>{'   ╭ ██      ██     ██████  ███████   ██   '}</Text>
                <Text color={PURPLE}>{' ██  ██ ██        ██ '}</Text>
            </Text>
            <Text bold>
                <Text color={BLUE}>{'   │ ██      ██     ██  ██  ██  ██    ██   '}</Text>
                <Text color={PURPLE}>{' ██  ██ ██  ●  ●  ██ '}</Text>
            </Text>
            <Text bold>
                <Text color={BLUE}>{'   ╰ █████   █████  ██  ██  ██  ██    ██   '}</Text>
                <Text color={PURPLE}>{'  ████   ██████████  ✦'}</Text>
            </Text>
            <Text bold>
                <Text color={BLUE}>{'      ╰── '}</Text>
                <Text color="#d9dde3">{'›_  '}</Text>
                <Text color={BLUE}>{'────────────────────────'}</Text>
                <Text color={PURPLE}>{'──────────╰────────╯'}</Text>
            </Text>
            <Text color={PURPLE}>{'— · —                                               — · —'}</Text>
            <Box marginTop={1}>
                <Text color="#aeb1b8">A better CLI for AI-powered development</Text>
            </Box>
            <Box
                marginTop={1}
                width="100%"
                borderStyle="single"
                borderTop
                borderBottom={false}
                borderLeft={false}
                borderRight={false}
                borderColor="#70417f"
            />
        </Box>
    );
}
