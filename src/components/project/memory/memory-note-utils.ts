import type { MemoryNote } from "../../../utils/memory-manifest-service.types";

/** Pinned first, then by ascending order, then most-recently-updated first. */
export const sortMemoryNotes = (notes: MemoryNote[]): MemoryNote[] =>
	[...notes].sort((left, right) => {
		if (Boolean(left.pinned) !== Boolean(right.pinned)) {
			return left.pinned ? -1 : 1;
		}
		const orderDelta = (left.order ?? 0) - (right.order ?? 0);
		if (orderDelta !== 0) {
			return orderDelta;
		}
		return right.updatedAt.localeCompare(left.updatedAt);
	});

/** Splits a comma-separated tag input into trimmed, non-empty tags. */
export const parseMemoryNoteTags = (value: string): string[] =>
	value
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
