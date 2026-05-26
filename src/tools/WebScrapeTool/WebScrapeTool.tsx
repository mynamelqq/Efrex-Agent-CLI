import { z } from 'zod/v4';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { getChatUICliUserAgent } from '../../utils/http.js';
import {
	getFirecrawlApiKey,
	getFirecrawlScrapeUrl,
} from '../../utils/firecrawlConfig.js';
import { PermissionResult } from 'src/types/permissions.js';
import {
	getToolUseSummary,
	renderToolResultMessage,
	renderToolUseMessage,
} from '../WebFetchTool/UI.js';
import { WEB_SCRAPE_TOOL_NAME } from './prompt.js';

const DEFAULT_FORMATS = ['markdown'] as const;
const MAX_RESULT_BYTES = 100_000;

const formatSchema = z.enum([
	'markdown',
	'summary',
	'html',
	'rawHtml',
	'links',
	'images',
	'branding',
	'screenshot'
]);

const proxySchema = z.enum(['basic', 'enhanced', 'auto']);

const inputSchema = lazySchema(() =>
	z.strictObject({
		url: z.string().url().describe('The URL to scrape with Firecrawl'),
		prompt: z
			.string()
			.optional()
			.describe(
				'Optional natural-language question about the page; mapped to Firecrawl query format'
			),
		formats: z
			.array(formatSchema)
			.min(1)
			.optional()
			.describe('Additional Firecrawl output formats to request'),
		onlyMainContent: z
			.boolean()
			.optional()
			.describe('Return only the main content of the page'),
		onlyCleanContent: z
			.boolean()
			.optional()
			.describe('Apply Firecrawl content cleaning to markdown output'),
		includeTags: z
			.array(z.string().min(1))
			.optional()
			.describe('HTML tags to include'),
		excludeTags: z
			.array(z.string().min(1))
			.optional()
			.describe('HTML tags to exclude'),
		maxAge: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.describe('Maximum cache age in milliseconds'),
		waitFor: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.describe('Additional wait time in milliseconds before scraping'),
		timeout: z
			.number()
			.int()
			.positive()
			.optional()
			.describe('Request timeout in milliseconds'),
		mobile: z
			.boolean()
			.optional()
			.describe('Use a mobile browser profile'),
		proxy: proxySchema
			.optional()
			.describe('Firecrawl proxy mode: basic, enhanced, or auto')
	})
);
type InputSchema = ReturnType<typeof inputSchema>;
type Input = z.infer<InputSchema>;

const looseObjectSchema = z.object({}).catchall(z.unknown());

const outputSchema = lazySchema(() =>
	z.object({
		bytes: z.number().describe('Size of the serialized Firecrawl data in bytes'),
		code: z.number().describe('HTTP response status code'),
		codeText: z.string().describe('HTTP response status text'),
		result: z
			.string()
			.describe('Normalized scrape result for direct display to the model'),
		durationMs: z.number().describe('Time taken to complete the scrape'),
		url: z.string().describe('The URL that was scraped'),
		data: looseObjectSchema.describe('Raw Firecrawl data payload'),
		metadata: looseObjectSchema
			.optional()
			.describe('Metadata returned by Firecrawl'),
		warning: z.string().optional().describe('Optional Firecrawl warning')
	})
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type Output = z.infer<OutputSchema>;

type FirecrawlResponse = {
	success?: boolean;
	data?: Record<string, unknown>;
	error?: unknown;
	warning?: unknown;
};

function uniqueFormats(input: Input): Array<string | Record<string, unknown>> {
	const formats = new Set<string>(input.formats ?? DEFAULT_FORMATS);

	if (input.prompt?.trim()) {
		formats.add('markdown');
	}

	const normalized: Array<string | Record<string, unknown>> = [...formats];

	if (input.prompt?.trim()) {
		normalized.push({
			type: 'query',
			prompt: input.prompt.trim(),
		});
	}

	return normalized;
}

function buildRequestBody(input: Input): Record<string, unknown> {
	const body: Record<string, unknown> = {
		url: input.url,
		formats: uniqueFormats(input),
	};

	if (input.onlyMainContent !== undefined) {
		body.onlyMainContent = input.onlyMainContent;
	}
	if (input.onlyCleanContent !== undefined) {
		body.onlyCleanContent = input.onlyCleanContent;
	}
	if (input.includeTags?.length) {
		body.includeTags = input.includeTags;
	}
	if (input.excludeTags?.length) {
		body.excludeTags = input.excludeTags;
	}
	if (input.maxAge !== undefined) {
		body.maxAge = input.maxAge;
	}
	if (input.waitFor !== undefined) {
		body.waitFor = input.waitFor;
	}
	if (input.timeout !== undefined) {
		body.timeout = input.timeout;
	}
	if (input.mobile !== undefined) {
		body.mobile = input.mobile;
	}
	if (input.proxy) {
		body.proxy = input.proxy;
	}

	return body;
}

function getString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatUnknown(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function truncateUtf8Bytes(text: string, maxBytes: number): string {
	const byteLength = Buffer.byteLength(text, 'utf8');
	if (byteLength <= maxBytes) {
		return text;
	}

	const truncated = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
	return truncated.replace(/\uFFFD$/, '');
}

function buildResultText(data: Record<string, unknown>, prompt?: string): string {
	const sections: string[] = [];
	const metadata =
		data.metadata && typeof data.metadata === 'object'
			? (data.metadata as Record<string, unknown>)
			: undefined;

	const answer = getString(data.answer);
	if (answer) {
		sections.push(`Answer:\n${answer}`);
	}

	const markdown = getString(data.markdown);
	if (markdown) {
		sections.push(`Markdown:\n${markdown}`);
	}

	const summary = getString(data.summary);
	if (summary) {
		sections.push(`Summary:\n${summary}`);
	}

	const html = getString(data.html);
	if (html) {
		sections.push(`HTML:\n${html}`);
	}

	const rawHtml = getString(data.rawHtml);
	if (rawHtml) {
		sections.push(`Raw HTML:\n${rawHtml}`);
	}

	if (Array.isArray(data.links) && data.links.length > 0) {
		sections.push(`Links:\n${(data.links as unknown[]).map(link => `- ${formatUnknown(link)}`).join('\n')}`);
	}

	if (Array.isArray(data.images) && data.images.length > 0) {
		sections.push(`Images:\n${(data.images as unknown[]).map(image => `- ${formatUnknown(image)}`).join('\n')}`);
	}

	const screenshot = getString(data.screenshot);
	if (screenshot) {
		sections.push(`Screenshot URL:\n${screenshot}`);
	}

	if (data.json !== undefined) {
		sections.push(`JSON:\n${formatUnknown(data.json)}`);
	}

	if (data.branding !== undefined) {
		sections.push(`Branding:\n${formatUnknown(data.branding)}`);
	}

	if (metadata) {
		const title = getString(metadata.title);
		const sourceURL = getString(metadata.sourceURL) ?? getString(metadata.url);
		const statusCode =
			typeof metadata.statusCode === 'number' ? metadata.statusCode : undefined;
		const contentType = getString(metadata.contentType);

		const metadataLines = [
			title ? `title: ${title}` : undefined,
			sourceURL ? `sourceURL: ${sourceURL}` : undefined,
			statusCode !== undefined ? `statusCode: ${statusCode}` : undefined,
			contentType ? `contentType: ${contentType}` : undefined,
			prompt ? `prompt: ${prompt}` : undefined,
		].filter(Boolean);

		if (metadataLines.length > 0) {
			sections.unshift(`Metadata:\n${metadataLines.join('\n')}`);
		}
	}

	if (sections.length === 0) {
		return formatUnknown(data);
	}

	return sections.join('\n\n');
}

async function scrapeFirecrawl(
	input: Input,
	signal: AbortSignal
): Promise<{
	code: number;
	codeText: string;
	data: Record<string, unknown>;
	warning?: string;
}> {
	const apiKey = getFirecrawlApiKey();
	if (!apiKey) {
		throw new Error('FIRECRAWL_API_KEY is required to use WebScrape');
	}

	const response = await fetch(getFirecrawlScrapeUrl(), {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'User-Agent': `${getChatUICliUserAgent()} WebScrape`,
		},
		body: JSON.stringify(buildRequestBody(input)),
		signal,
	});

	const text = await response.text();
	let payload: FirecrawlResponse;
	try {
		payload = JSON.parse(text) as FirecrawlResponse;
	} catch {
		throw new Error(
			`Firecrawl scrape returned non-JSON response (${response.status} ${response.statusText})`
		);
	}

	if (!response.ok || payload.success === false || !payload.data) {
		const error =
			typeof payload.error === 'string'
				? payload.error
				: response.statusText || 'Unknown Firecrawl error';
		throw new Error(`Firecrawl scrape failed: ${error}`);
	}

	return {
		code: response.status,
		codeText: response.statusText,
		data: payload.data,
		warning: getString(payload.warning),
	};
}

export const WebScrapeTool = buildTool({
	name: WEB_SCRAPE_TOOL_NAME,
	searchHint: 'scrape a web page through Firecrawl and extract clean content',
	maxResultSizeChars: 100_000,
	async description(input) {
		return `Claude wants to scrape ${input.url} with Firecrawl`;
	},
	userFacingName() {
		return 'Fetch';
	},
	renderToolResultMessage,
	renderToolUseMessage,
	getToolUseSummary,
	get inputSchema(): InputSchema {
		return inputSchema();
	},
	get outputSchema(): OutputSchema {
		return outputSchema();
	},
	isEnabled() {
		return true;
	},
	isConcurrencySafe() {
		return true;
	},
	isReadOnly() {
		return true;
	},
	async call(input, { abortController }) {
		const startTime = performance.now();
		const { code, codeText, data, warning } = await scrapeFirecrawl(
			input,
			abortController.signal
		);
		const baseResult = buildResultText(data, input.prompt);
		const result = truncateUtf8Bytes(baseResult, MAX_RESULT_BYTES);
		const resultWasTruncated = result !== baseResult;
		const serialized = JSON.stringify(data);
		const finalResult = warning
			? `${result}\n\nWarning:\n${warning}`
			: result;

		return {
			data: {
				bytes: Buffer.byteLength(serialized),
				code,
				codeText,
				result: resultWasTruncated
					? `${finalResult}\n\n[Truncated to ${MAX_RESULT_BYTES} bytes]`
					: finalResult,
				durationMs: performance.now() - startTime,
				url: input.url,
				data,
				metadata:
					data.metadata && typeof data.metadata === 'object'
						? (data.metadata as Record<string, unknown>)
						: undefined,
				warning,
			},
		};
	},
	mapToolResultToToolResultBlockParam({ result }, toolUseID) {
		return {
			tool_use_id: toolUseID,
			type: 'tool_result',
			content: result,
		};
	},
	async checkPermissions(): Promise<PermissionResult> {
		return {
			behavior: 'passthrough',
			message: 'WebScrapeTool requires permission.',
			suggestions: [
				{
					type: 'addRules',
					rules: [{ toolName: WEB_SCRAPE_TOOL_NAME }],
					behavior: 'allow',
					destination: 'localSettings',
				},
			],
		};
	},
} satisfies ToolDef<InputSchema, Output>);
