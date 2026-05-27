#!/usr/bin/env bun

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMacroDefines } from './defines';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const entrypoint = join(projectRoot, 'index.tsx');
const passthroughArgs = process.argv.slice(2);


const defineArgs = Object.entries(getMacroDefines()).flatMap(([key, value]) => [
	'-d',
	`${key}:${value}`,
]);

const result = Bun.spawnSync(
	[
		'bun',
		'run',
		...defineArgs,
		entrypoint,
		...passthroughArgs,
	],
	{
		cwd: projectRoot,
		stdio: ['inherit', 'inherit', 'inherit'],
	},
);

process.exit(result.exitCode ?? 0);
