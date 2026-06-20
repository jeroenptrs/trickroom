export function compoundWhenSignature(when: Record<string, string | string[]>) {
	const normalized: Record<string, string | string[]> = {};
	for (const axisKey of Object.keys(when).sort((left, right) =>
		left.localeCompare(right),
	)) {
		const value = when[axisKey];
		normalized[axisKey] = Array.isArray(value)
			? [...value].sort((left, right) => left.localeCompare(right))
			: value;
	}
	return JSON.stringify(normalized);
}
