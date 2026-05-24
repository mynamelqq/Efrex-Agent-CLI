import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { memo } from 'react';
import { useSettings } from '../hooks/useSettings.js';
import { Box, NoSelect, RawAnsi, useTheme } from '@anthropic/ink';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import sliceAnsi from '../utils/sliceAnsi.js';
import { expectColorDiff } from './StructuredDiff/colorDiff.js';
import { StructuredDiffFallback } from './StructuredDiff/Fallback.js';

type Props = {
	patch: StructuredPatchHunk;
	dim: boolean;
	filePath: string;
	firstLine: string | null;
	fileContent?: string;
	width: number;
	skipHighlighting?: boolean;
};

type CachedRender = {
	lines: string[];
	gutterWidth: number;
	gutters: string[] | null;
	contents: string[] | null;
};

const RENDER_CACHE = new WeakMap<
	StructuredPatchHunk,
	Map<string, CachedRender>
>();

function computeGutterWidth(patch: StructuredPatchHunk): number {
	const maxLineNumber = Math.max(
		patch.oldStart + patch.oldLines - 1,
		patch.newStart + patch.newLines - 1,
		1
	);
	return maxLineNumber.toString().length + 3;
}

function renderColorDiff(
	patch: StructuredPatchHunk,
	firstLine: string | null,
	filePath: string,
	fileContent: string | null,
	theme: string,
	width: number,
	dim: boolean,
	splitGutter: boolean
): CachedRender | null {
	const ColorDiff = expectColorDiff();
	if (!ColorDiff) {
		return null;
	}

	const rawGutterWidth = splitGutter ? computeGutterWidth(patch) : 0;
	const gutterWidth =
		rawGutterWidth > 0 && rawGutterWidth < width ? rawGutterWidth : 0;
	const key = `${theme}|${width}|${dim ? 1 : 0}|${gutterWidth}|${firstLine ?? ''}|${filePath}`;

	let perHunk = RENDER_CACHE.get(patch);
	const cached = perHunk?.get(key);
	if (cached) {
		return cached;
	}

	const lines = new ColorDiff(patch, firstLine, filePath, fileContent).render(
		theme,
		width,
		dim
	);
	if (lines === null) {
		return null;
	}

	let gutters: string[] | null = null;
	let contents: string[] | null = null;
	if (gutterWidth > 0) {
		gutters = lines.map(line => sliceAnsi(line, 0, gutterWidth));
		contents = lines.map(line => sliceAnsi(line, gutterWidth));
	}

	const entry: CachedRender = { lines, gutterWidth, gutters, contents };
	if (!perHunk) {
		perHunk = new Map();
		RENDER_CACHE.set(patch, perHunk);
	}
	if (perHunk.size >= 4) {
		perHunk.clear();
	}
	perHunk.set(key, entry);
	return entry;
}

export const StructuredDiff = memo(function StructuredDiff({
	patch,
	dim,
	filePath,
	firstLine,
	fileContent,
	width,
	skipHighlighting = false
}: Props): React.ReactNode {
	const [theme] = useTheme();
	const settings = useSettings();
	const syntaxHighlightingDisabled =
		settings.syntaxHighlightingDisabled ?? false;
	const safeWidth = Math.max(1, Math.floor(width));
	const splitGutter = isFullscreenEnvEnabled();

	const cached =
		skipHighlighting || syntaxHighlightingDisabled
			? null
			: renderColorDiff(
					patch,
					firstLine,
					filePath,
					fileContent ?? null,
					theme,
					safeWidth,
					dim,
					splitGutter
				);

	if (!cached) {
		return (
			<Box>
				<StructuredDiffFallback patch={patch} dim={dim} width={width} />
			</Box>
		);
	}

	const { lines, gutterWidth, gutters, contents } = cached;
	if (gutterWidth > 0 && gutters && contents) {
		return (
			<Box flexDirection="row">
				<NoSelect fromLeftEdge>
					<RawAnsi lines={gutters} width={gutterWidth} />
				</NoSelect>
				<RawAnsi lines={contents} width={safeWidth - gutterWidth} />
			</Box>
		);
	}

	return (
		<Box>
			<RawAnsi lines={lines} width={safeWidth} />
		</Box>
	);
});
