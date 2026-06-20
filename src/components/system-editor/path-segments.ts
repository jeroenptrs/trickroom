export function getParentPathSegment(sourcePath: string) {
	const normalized = sourcePath.trim().replaceAll("\\", "/");
	const slashIndex = normalized.lastIndexOf("/");
	if (slashIndex <= 0) {
		return "(root)";
	}
	return normalized.slice(0, slashIndex);
}

export function groupItemsByPathSegment<T extends { sourcePath: string }>(
	items: readonly T[],
): { segment: string; items: T[] }[] {
	const grouped = new Map<string, T[]>();

	for (const item of items) {
		const segment = getParentPathSegment(item.sourcePath);
		const rows = grouped.get(segment) ?? [];
		rows.push(item);
		grouped.set(segment, rows);
	}

	return [...grouped.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([segment, segmentItems]) => ({
			segment,
			items: [...segmentItems].sort((left, right) =>
				left.name.localeCompare(right.name),
			),
		}));
}

export function resolveIconFolderSegment(
	sourcePath: string,
	iconFolderPaths: readonly string[],
) {
	const normalizedPath = sourcePath.trim().replaceAll("\\", "/");
	let bestMatch: string | null = null;

	for (const folder of iconFolderPaths) {
		const normalizedFolder = folder.trim().replaceAll("\\", "/").replace(/\/+$/, "");
		if (!normalizedFolder) {
			continue;
		}

		const prefix = `${normalizedFolder}/`;
		if (
			normalizedPath === normalizedFolder ||
			normalizedPath.startsWith(prefix)
		) {
			if (!bestMatch || normalizedFolder.length > bestMatch.length) {
				bestMatch = normalizedFolder;
			}
		}
	}

	return bestMatch ?? getParentPathSegment(normalizedPath);
}
