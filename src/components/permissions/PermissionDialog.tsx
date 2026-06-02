import * as React from 'react';
import { Box, Text } from '../../ink.js';

type PermissionDialogProps = {
	title: string;
	subtitle?: React.ReactNode;
	color?:
		| 'ansi:blackBright'
		| 'ansi:blue'
		| 'ansi:blueBright'
		| 'ansi:cyan'
		| 'ansi:cyanBright'
		| 'ansi:green'
		| 'ansi:greenBright'
		| 'ansi:magenta'
		| 'ansi:magentaBright'
		| 'ansi:red'
		| 'ansi:redBright'
		| 'ansi:white'
		| 'ansi:whiteBright'
		| 'ansi:yellow'
		| 'ansi:yellowBright';
	titleRight?: React.ReactNode;
	children: React.ReactNode;
};

export function PermissionDialog({
	title,
	subtitle,
	color = 'ansi:cyanBright',
	titleRight,
	children
}: PermissionDialogProps): React.ReactNode {
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={color}
			borderLeft={false}
			borderRight={false}
			borderBottom={false}
			marginTop={0}
		>
			<Box paddingX={1} paddingTop={0} paddingBottom={0} flexDirection="column">
				<Box justifyContent="space-between">
					<Box flexDirection="row" flexGrow={1}>
						<Text color={color} bold>
							?{' '}
						</Text>
						<Text color="ansi:whiteBright" bold>
							{title}
						</Text>
						{subtitle ? <Text color={color}>  {subtitle}</Text> : null}
					</Box>
					{titleRight}
				</Box>
			</Box>
			<Box flexDirection="column" paddingX={1}>
				{children}
			</Box>
		</Box>
	);
}
