const ONE_M_CONTEXT_SUFFIX = /\[1m\]$/i;

export function has1mContext(model: string | null | undefined): boolean {
	return typeof model === 'string' && ONE_M_CONTEXT_SUFFIX.test(model.trim());
}

export function strip1mContextSuffix(model: string): string {
	return model.replace(ONE_M_CONTEXT_SUFFIX, '');
}
