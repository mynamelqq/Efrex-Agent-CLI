#!/usr/bin/env bun

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { getMacroDefines } from './defines';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const outdir = join(projectRoot, 'dist');

mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
	entrypoints: [join(projectRoot, 'index.tsx')],
	outdir,
	target: 'bun',
	format: 'esm',
	define: getMacroDefines(),
});

if (!result.success) {
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}
