// Browser-safe memory-reference primitives: constants, types, and the pure
// parsing/deep-link helpers. This module must not import Node-only services
// (manifest stores, file services) so it can be bundled into client code.
// Node-backed resolution lives in `memory-references.ts`, which re-exports
// everything here.

export const MEMORY_REFERENCE_TYPES = [
	"design",
	"component",
	"token",
	"asset",
	"icon",
] as const;

export type MemoryReferenceType = (typeof MEMORY_REFERENCE_TYPES)[number];

export type MemoryReferenceToken = {
	type: MemoryReferenceType;
	id: string;
	raw: string;
	start: number;
	end: number;
};

export type MemoryReferenceStatus = "valid" | "broken" | "unresolvable_scope";

export type ResolvedMemoryReference = MemoryReferenceToken & {
	status: MemoryReferenceStatus;
	label?: string;
	detail?: string;
	/** In-app route for valid targets (design editor or system editor). */
	deepLink?: string;
};

export type MemoryReferenceWarning = {
	raw: string;
	type: MemoryReferenceType;
	id: string;
	status: Exclude<MemoryReferenceStatus, "valid">;
	message: string;
};

// Matches {{type:id}} with optional surrounding whitespace. Bodies are stored
// verbatim; this only reads tokens for validation/resolution.
const REFERENCE_PATTERN =
	/\{\{\s*(design|component|token|asset|icon)\s*:\s*([^}]+?)\s*\}\}/g;

export function parseMemoryReferences(body: string): MemoryReferenceToken[] {
	const tokens: MemoryReferenceToken[] = [];
	REFERENCE_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null = REFERENCE_PATTERN.exec(body);
	while (match !== null) {
		const id = match[2]?.trim() ?? "";
		if (id.length > 0) {
			tokens.push({
				type: match[1] as MemoryReferenceType,
				id,
				raw: match[0],
				start: match.index,
				end: match.index + match[0].length,
			});
		}
		match = REFERENCE_PATTERN.exec(body);
	}
	return tokens;
}

/** Builds an in-app navigation path for a resolved reference target. */
export function buildMemoryReferenceDeepLink(
	type: MemoryReferenceType,
	targetId: string,
	systemId?: string | null,
): string | undefined {
	if (type === "design") {
		return `/design/${targetId}`;
	}
	if (!systemId) {
		return undefined;
	}
	const systemPath = `/system/${encodeURIComponent(systemId)}`;
	if (type === "component") {
		return `${systemPath}?component=${encodeURIComponent(targetId)}`;
	}
	if (type === "token") {
		return `${systemPath}?tab=tokens`;
	}
	if (type === "asset") {
		return `${systemPath}?tab=assets`;
	}
	return `${systemPath}?tab=icons`;
}
