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
	width
}: Props): React.ReactNode {
	const preview = useMemo(() => buildPreviewData(toolName, input), [toolName, input]);

	if (!preview) {
		return null;
	}

	if (preview.kind === 'create') {
		return (
			<Box flexDirection="column" marginTop={1}>
				<Text color="ansi:blackBright">Preview</Text>
				<HighlightedCode
					code={preview.content || '(No content)'}
					filePath={preview.filePath}
					width={width}
				/>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			<Text color="ansi:blackBright">Preview</Text>
			<StructuredDiffList
				hunks={preview.patch}
				dim={false}
				width={width}
				filePath={preview.filePath}
				firstLine={firstLineOf(preview.originalFile)}
				fileContent={preview.originalFile}
			/>
		</Box>
	);
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
