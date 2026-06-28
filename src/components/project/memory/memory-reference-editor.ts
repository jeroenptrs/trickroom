import {
	MEMORY_REFERENCE_TYPES,
	type MemoryReferenceType,
	type ResolvedMemoryReference,
} from "../../../utils/memory-references.shared";

export type ActiveReferenceTrigger =
	| {
			kind: "types";
			start: number;
			end: number;
			filter: string;
	  }
	| {
			kind: "targets";
			type: MemoryReferenceType;
			query: string;
			start: number;
			end: number;
	  };

const TRIGGER_PATTERN =
	/\{\{\s*(?:(design|component|token|asset|icon)\s*:\s*)?([^}]*)$/;

export const MEMORY_REFERENCE_TYPE_LABELS: Record<MemoryReferenceType, string> =
	{
		design: "Design",
		component: "Component",
		token: "Token",
		asset: "Asset",
		icon: "Icon",
	};

/** Detects whether the caret is inside an unfinished `{{…}}` reference token. */
export function detectActiveReferenceTrigger(
	body: string,
	cursor: number,
): ActiveReferenceTrigger | null {
	const before = body.slice(0, cursor);
	const match = before.match(TRIGGER_PATTERN);
	if (!match || match.index === undefined) {
		return null;
	}

	const start = match.index;
	const type = match[1] as MemoryReferenceType | undefined;
	const query = (match[2] ?? "").trim();

	if (!type) {
		return { kind: "types", start, end: cursor, filter: query };
	}

	return { kind: "targets", type, query, start, end: cursor };
}

export const filterReferenceTypes = (filter: string): MemoryReferenceType[] => {
	const needle = filter.trim().toLowerCase();
	if (needle.length === 0) {
		return [...MEMORY_REFERENCE_TYPES];
	}
	return MEMORY_REFERENCE_TYPES.filter(
		(type) =>
			type.includes(needle) ||
			MEMORY_REFERENCE_TYPE_LABELS[type].toLowerCase().includes(needle),
	);
};

export const formatMemoryReferenceToken = (
	type: MemoryReferenceType,
	id: string,
): string => `{{${type}:${id}}}`;

export const insertMemoryReferenceToken = (
	body: string,
	trigger: ActiveReferenceTrigger,
	token: string,
): { nextBody: string; nextCursor: number } => {
	const nextBody =
		body.slice(0, trigger.start) + token + body.slice(trigger.end);
	return { nextBody, nextCursor: trigger.start + token.length };
};

export type MemoryBodySegment =
	| { kind: "text"; text: string }
	| { kind: "reference"; reference: ResolvedMemoryReference };

/** Splits a note body into plain-text runs and resolved reference spans. */
export function buildMemoryBodySegments(
	body: string,
	references: ResolvedMemoryReference[],
): MemoryBodySegment[] {
	if (references.length === 0) {
		return body.length > 0 ? [{ kind: "text", text: body }] : [];
	}

	const sorted = [...references].sort(
		(left, right) => left.start - right.start,
	);
	const segments: MemoryBodySegment[] = [];
	let cursor = 0;

	for (const reference of sorted) {
		if (reference.start < cursor) {
			continue;
		}
		if (reference.start > cursor) {
			segments.push({
				kind: "text",
				text: body.slice(cursor, reference.start),
			});
		}
		segments.push({ kind: "reference", reference });
		cursor = reference.end;
	}

	if (cursor < body.length) {
		segments.push({ kind: "text", text: body.slice(cursor) });
	}

	return segments;
}
