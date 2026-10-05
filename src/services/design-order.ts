/**
 * Board order keys for the folder design layout.
 *
 * Every board file stores an `order` key; boards sort by key, then by board
 * id. Keys are fractional indexes: base-62 digit strings compared as plain
 * strings, where a key can always be generated between two others. Inserting
 * a board between two boards, or moving one, rewrites only that board's file,
 * and two branches that each add a board touch no shared file.
 *
 * The midpoint algorithm follows David Greenspan's "Implementing Fractional
 * Indexing" (as in the `fractional-indexing` package), without the integer
 * part: keys never end in the zero digit, so there is room between any two.
 */

const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const zero = digits[0] as string;

const validKeyPattern = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

/** Whether a stored order key can take part in key generation. */
export const isValidOrderKey = (key: unknown): key is string =>
	typeof key === "string" && validKeyPattern.test(key);

const midpoint = (a: string, b: string | null): string => {
	if (b !== null) {
		let shared = 0;
		while ((a[shared] ?? zero) === b[shared]) {
			shared += 1;
		}
		if (shared > 0) {
			return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
		}
	}

	const digitA = a ? digits.indexOf(a[0] as string) : 0;
	const digitB = b !== null ? digits.indexOf(b[0] as string) : digits.length;
	if (digitB - digitA > 1) {
		return digits[Math.round((digitA + digitB) / 2)] as string;
	}
	if (b !== null && b.length > 1) {
		return b.slice(0, 1);
	}
	return (digits[digitA] as string) + midpoint(a.slice(1), null);
};

/** A key strictly between `before` and `after` (either may be open). */
export const generateOrderKeyBetween = (
	before: string | null,
	after: string | null,
): string => {
	if (before !== null && after !== null && before >= after) {
		throw new Error(`Order key ${before} is not before ${after}`);
	}
	return midpoint(before ?? "", after);
};

/** `count` evenly spread keys strictly between `before` and `after`. */
export const generateOrderKeysBetween = (
	before: string | null,
	after: string | null,
	count: number,
): string[] => {
	if (count <= 0) {
		return [];
	}
	if (count === 1) {
		return [generateOrderKeyBetween(before, after)];
	}
	const middleIndex = Math.floor(count / 2);
	const middle = generateOrderKeyBetween(before, after);
	return [
		...generateOrderKeysBetween(before, middle, middleIndex),
		middle,
		...generateOrderKeysBetween(middle, after, count - middleIndex - 1),
	];
};

type OrderedEntry = { id: string; key: string };

const compareEntries = (left: OrderedEntry, right: OrderedEntry) =>
	left.key < right.key
		? -1
		: left.key > right.key
			? 1
			: left.id < right.id
				? -1
				: left.id > right.id
					? 1
					: 0;

/** Sorts stored boards by order key, then id; invalid keys sort last. */
export const compareStoredBoardOrder = (
	left: { id: string; order: unknown },
	right: { id: string; order: unknown },
) => {
	const leftValid = isValidOrderKey(left.order);
	const rightValid = isValidOrderKey(right.order);
	if (leftValid !== rightValid) {
		return leftValid ? -1 : 1;
	}
	return compareEntries(
		{ id: left.id, key: leftValid ? (left.order as string) : "" },
		{ id: right.id, key: rightValid ? (right.order as string) : "" },
	);
};

/** Indexes of a longest strictly increasing subsequence of `entries`. */
const longestIncreasingRun = (entries: readonly OrderedEntry[]) => {
	const tails: number[] = [];
	const previous = new Array<number>(entries.length).fill(-1);
	entries.forEach((entry, index) => {
		let low = 0;
		let high = tails.length;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (
				compareEntries(entries[tails[mid] as number] as OrderedEntry, entry) < 0
			) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		if (low > 0) {
			previous[index] = tails[low - 1] as number;
		}
		tails[low] = index;
	});
	const kept = new Set<number>();
	let cursor = tails[tails.length - 1] ?? -1;
	while (cursor !== -1) {
		kept.add(cursor);
		cursor = previous[cursor] as number;
	}
	return kept;
};

/**
 * Assigns order keys to boards in their final order, keeping as many existing
 * keys as possible: boards that already sort correctly keep their key, and
 * only the rest (new boards, moved boards, boards with an invalid key) get a
 * new one. Returns a key for every board.
 */
export const assignOrderKeys = (
	boards: readonly { id: string; key: string | null }[],
): Map<string, string> => {
	const candidates = boards.flatMap((board, position) =>
		isValidOrderKey(board.key)
			? [{ position, entry: { id: board.id, key: board.key } }]
			: [],
	);
	const run = longestIncreasingRun(candidates.map(({ entry }) => entry));
	const keep = new Set(
		[...run].map(
			(index) => (candidates[index] as { position: number }).position,
		),
	);

	// A gap between two kept boards with equal keys (a tie broken by id) has
	// no room for new keys; give up the right-hand board until there is room.
	for (;;) {
		let changed = false;
		let previousKey: string | null = null;
		let pending = false;
		for (const [position, board] of boards.entries()) {
			if (!keep.has(position)) {
				pending = true;
				continue;
			}
			const key = board.key as string;
			if (pending && previousKey !== null && previousKey >= key) {
				keep.delete(position);
				changed = true;
				break;
			}
			previousKey = key;
			pending = false;
		}
		if (!changed) {
			break;
		}
	}

	const keys = new Map<string, string>();
	let position = 0;
	let previousKey: string | null = null;
	while (position < boards.length) {
		const board = boards[position] as { id: string; key: string | null };
		if (keep.has(position)) {
			keys.set(board.id, board.key as string);
			previousKey = board.key;
			position += 1;
			continue;
		}
		let end = position;
		while (end < boards.length && !keep.has(end)) {
			end += 1;
		}
		const nextKey = end < boards.length ? (boards[end]?.key as string) : null;
		const generated = generateOrderKeysBetween(
			previousKey,
			nextKey,
			end - position,
		);
		for (let index = position; index < end; index += 1) {
			keys.set(
				(boards[index] as { id: string }).id,
				generated[index - position] as string,
			);
		}
		previousKey = generated[generated.length - 1] ?? previousKey;
		position = end;
	}
	return keys;
};
