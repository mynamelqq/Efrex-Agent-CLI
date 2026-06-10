import * as React from 'react';
import { useMemo } from 'react';
import { Box, Text } from '../../ink.js';
import { HighlightedCode } from '../HighlightedCode.js';
import { StructuredDiffList } from '../StructuredDiffList.js';
import { readFileSyncWithMetadata } from '../../utils/fileRead.js';
import { expandPath } from '../../utils/path.js';
import { firstLineOf } from '../../utils/stringUtils.js';
import { getPatchForDisplay } from '../../utils/diff.js';
import {
	findActualString,
	getPatchForEdit,
	preserveQuoteStyle
} from '../../tools/FileEditTool/utils.js';
import { isENOENT } from '../../utils/errors.js';

type Props = {
	toolName: string;
	input: unknown;
	width: number;
	maxLines?: number | null;
	showOmitted?: boolean;
	compact?: boolean;
};

type EditPreview = {
	kind: 'diff';
	filePath: string;
	originalFile: string;
	patch: Array<{
		oldStart: number;
		oldLines: number;
		newStart: number;
		newLines: number;
		lines: string[];
	}>;
};

type CreatePreview = {
	kind: 'create';
	filePath: string;
	content: string;
};

type PreviewData = EditPreview | CreatePreview | null;

export function FileToolPermissionPreview({
	toolName,
	input,
	width,
	maxLines = null,
	showOmitted = true,
	compact = false
}: Props): React.ReactNode {
	const preview = useMemo(() => buildPreviewData(toolName, input), [toolName, input]);

	if (!preview) {
		return null;
	}

	if (preview.kind === 'create') {
		const { text, omitted } = truncateTextLines(
			preview.content || '(No content)',
			maxLines
		);
		return (
			<Box flexDirection="column" marginTop={compact ? 0 : 1}>
				<HighlightedCode
					code={text}
					filePath={preview.filePath}
					width={width}
				/>
				{showOmitted && omitted > 0 ? (
					<Text color="ansi:blackBright">
						... +{omitted} more {omitted === 1 ? 'line' : 'lines'}
					</Text>
				) : null}
			</Box>
		);
	}

	const { hunks, omitted } = truncatePatchLines(
		preview.patch,
		maxLines
	);

	return (
		<Box flexDirection="column" marginTop={compact ? 0 : 1}>
			<StructuredDiffList
				hunks={hunks}
				dim={false}
				width={width}
				filePath={preview.filePath}
				firstLine={firstLineOf(preview.originalFile)}
				fileContent={preview.originalFile}
			/>
			{showOmitted && omitted > 0 ? (
				<Text color="ansi:blackBright">
					... +{omitted} more {omitted === 1 ? 'line' : 'lines'}
				</Text>
			) : null}
		</Box>
	);
}

function truncateTextLines(
	text: string,
	maxLines: number | null
): { text: string; omitted: number } {
	const lines = text.split('\n');
	if (maxLines === null) {
		return { text, omitted: 0 };
	}

	if (lines.length <= maxLines) {
		return { text, omitted: 0 };
	}

	return {
		text: lines.slice(0, maxLines).join('\n'),
		omitted: lines.length - maxLines
	};
}

function truncatePatchLines(
	hunks: EditPreview['patch'],
	maxLines: number | null
): { hunks: EditPreview['patch']; omitted: number } {
	if (maxLines === null) {
		return { hunks, omitted: 0 };
	}

	if (maxLines > 0 && maxLines < 6) {
		return truncatePatchAroundChanges(hunks, maxLines);
	}

	let remaining = maxLines;
	let omitted = 0;
	const result: EditPreview['patch'] = [];

	for (const hunk of hunks) {
		if (remaining <= 0) {
			omitted += hunk.lines.length;
			continue;
		}

		if (hunk.lines.length <= remaining) {
			result.push(hunk);
			remaining -= hunk.lines.length;
			continue;
		}

		result.push({
			...hunk,
			lines: hunk.lines.slice(0, remaining)
		});
		omitted += hunk.lines.length - remaining;
		remaining = 0;
	}

	return { hunks: result, omitted };
}

function truncatePatchAroundChanges(
	hunks: EditPreview['patch'],
	maxLines: number
): { hunks: EditPreview['patch']; omitted: number } {
	for (const hunk of hunks) {
		const changeIndex = hunk.lines.findIndex(line =>
			(line.startsWith('+') || line.startsWith('-')) &&
			!line.startsWith('+++') &&
			!line.startsWith('---')
		);

		if (changeIndex === -1) {
			continue;
		}

		const contextBefore = maxLines >= 4 ? 1 : 0;
		const start = Math.max(0, changeIndex - contextBefore);
		const end = Math.min(hunk.lines.length, start + maxLines);

		return {
			hunks: [
				{
					...hunk,
					lines: hunk.lines.slice(start, end)
				}
			],
			omitted: Math.max(0, hunk.lines.length - (end - start)) +
				hunks
					.filter(item => item !== hunk)
					.reduce((total, item) => total + item.lines.length, 0)
		};
	}

	return truncatePatchLines(hunks, Math.max(6, maxLines));
}

function buildPreviewData(toolName: string, input: unknown): PreviewData {
	try {
		const record = asRecord(input);

		if (toolName === 'Edit') {
			return buildEditPreview(record);
		}

		if (toolName === 'Write') {
			return buildWritePreview(record);
		}
	} catch {
		return null;
	}

	return null;
}

function buildEditPreview(record: Record<string, unknown>): PreviewData {
	const filePath = readString(record.file_path);
	const oldString = readString(record.old_string);
	const newString = readString(record.new_string);
	const replaceAll = Boolean(record.replace_all ?? false);
	if (!filePath || oldString === null || newString === null) {
		return null;
	}

	const absolutePath = expandPath(filePath);
	const originalFile = readFileOrNull(absolutePath) ?? '';
	const actualOldString = findActualString(originalFile, oldString) || oldString;
	const actualNewString = preserveQuoteStyle(
		oldString,
		actualOldString,
		newString
	);
	const { patch } = getPatchForEdit({
		filePath: absolutePath,
		fileContents: originalFile,
		oldString: actualOldString,
		newString: actualNewString,
		replaceAll
	});

	return {
		kind: 'diff',
		filePath,
		originalFile,
		patch
	};
}

function buildWritePreview(record: Record<string, unknown>): PreviewData {
	const filePath = readString(record.file_path);
	const content = readString(record.content);
	if (!filePath || content === null) {
		return null;
	}

	const absolutePath = expandPath(filePath);
	const originalFile = readFileOrNull(absolutePath);
	if (originalFile === null) {
		return {
			kind: 'create',
			filePath,
			content
		};
	}

	const patch = getPatchForDisplay({
		filePath,
		fileContents: originalFile,
		edits: [
			{
				old_string: originalFile,
				new_string: content,
				replace_all: false
			}
		]
	});

	return {
		kind: 'diff',
		filePath,
		originalFile,
		patch
	};
}

function readFileOrNull(path: string): string | null {
	try {
		return readFileSyncWithMetadata(path).content;
	} catch (error) {
		if (isENOENT(error)) {
			return null;
		}
		return null;
	}
}

function readString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object'
		? (value as Record<string, unknown>)
		: {};
}
