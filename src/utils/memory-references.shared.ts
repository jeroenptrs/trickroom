// Browser-safe memory-reference primitives: constants, types, and the pure
// parsing/deep-link helpers. This module must not import Node-only services
// (manifest stores, file services) so it can be bundled into client code.
// Node-backed resolution lives in `memory-references.ts`, which re-exports
// everything here.

import { buildDesignPath, type DesignDeepLinkTarget } from "./design-deep-link";

export const MEMORY_REFERENCE_TYPES = [
	"design",
	"board",
	"layer",
	"component",
	"token",
	"asset",
	"icon",
] as const;

export type MemoryReferenceType = (typeof MEMORY_REFERENCE_TYPES)[number];

/**
 * Types whose id names something inside a design: `<designId>/<boardId>` for
 * a board, `<designId>/<elementId>` for a layer. Neither id can contain `/`.
 */
export const DESIGN_SCOPED_REFERENCE_TYPES = ["board", "layer"] as const;

export type DesignScopedReferenceType =
	(typeof DESIGN_SCOPED_REFERENCE_TYPES)[number];

export const isDesignScopedReferenceType = (
	type: MemoryReferenceType,
): type is DesignScopedReferenceType => type === "board" || type === "layer";

/** Splits a board or layer reference id into its design and element ids. */
export function splitDesignScopedReferenceId(
	id: string,
): { designId: string; elementId: string } | null {
	const slashIndex = id.indexOf("/");
	if (slashIndex <= 0 || slashIndex !== id.lastIndexOf("/")) {
		return null;
	}
	const designId = id.slice(0, slashIndex).trim();
	const elementId = id.slice(slashIndex + 1).trim();
	return designId && elementId ? { designId, elementId } : null;
}

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
const REFERENCE_PATTERN = new RegExp(
	`\\{\\{\\s*(${MEMORY_REFERENCE_TYPES.join("|")})\\s*:\\s*([^}]+?)\\s*\\}\\}`,
	"g",
);

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

/**
 * Builds an in-app navigation path for a resolved reference target. Design
 * links can point at a board and a layer inside the design; board and layer
 * references point at theirs (`boardId` adds a layer's board).
 */
export function buildMemoryReferenceDeepLink(
	type: MemoryReferenceType,
	targetId: string,
	systemId?: string | null,
	designTarget?: DesignDeepLinkTarget,
): string | undefined {
	if (type === "design") {
		return buildDesignPath(targetId, designTarget);
	}
	if (isDesignScopedReferenceType(type)) {
		const target = splitDesignScopedReferenceId(targetId);
		if (!target) {
			return undefined;
		}
		return buildDesignPath(
			target.designId,
			type === "board"
				? { boardId: target.elementId }
				: { boardId: designTarget?.boardId, layerId: target.elementId },
		);
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
