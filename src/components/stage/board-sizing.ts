import { parseClassName } from "../../utils/tailwind-classname/parse";

const WIDTH_UTILITY_PREFIXES = ["w-", "min-w-", "max-w-", "size-"];
const HEIGHT_UTILITY_PREFIXES = ["h-", "min-h-", "max-h-", "size-"];
const ARBITRARY_WIDTH_PROPERTY = /^\[(?:min-|max-)?(?:width|inline-size):/;
const ARBITRARY_HEIGHT_PROPERTY = /^\[(?:min-|max-)?(?:height|block-size):/;

export type BoardSizing = {
	/** No width utility (any variant) or inline width: use the default min-width. */
	defaultWidth: boolean;
	/** No height utility (any variant) or inline height. */
	defaultHeight: boolean;
};

function hasStyleKey(style: unknown, pattern: RegExp) {
	return (
		typeof style === "object" &&
		style !== null &&
		Object.keys(style).some((key) => pattern.test(key))
	);
}

/**
 * Which stage sizing defaults apply to a board, from its resolved className
 * and inline style. A width/height utility under any variant (`md:w-96`)
 * counts as authored sizing, as does `w-full`, which resolves against the
 * stage `main` and inherits its default floor from there.
 */
export function resolveBoardSizing(
	className: unknown,
	style?: unknown,
): BoardSizing {
	let explicitWidth = hasStyleKey(style, /width|inlineSize/i);
	let explicitHeight = hasStyleKey(style, /height|blockSize/i);

	if (typeof className === "string") {
		for (const token of parseClassName(className)) {
			const utility = token.utility.replace(/^!/, "");
			if (
				WIDTH_UTILITY_PREFIXES.some((prefix) => utility.startsWith(prefix)) ||
				ARBITRARY_WIDTH_PROPERTY.test(utility)
			) {
				explicitWidth = true;
			}
			if (
				HEIGHT_UTILITY_PREFIXES.some((prefix) => utility.startsWith(prefix)) ||
				ARBITRARY_HEIGHT_PROPERTY.test(utility)
			) {
				explicitHeight = true;
			}
		}
	}

	return { defaultWidth: !explicitWidth, defaultHeight: !explicitHeight };
}
