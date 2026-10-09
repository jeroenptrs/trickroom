import { sha256Hex } from "../utils/sha256";
import { stableStringify } from "../utils/system-component-template-hash";
import type { DerivedTwMerge } from "../utils/tailwind-merge-derive";
import { formatTwMergeHeader, type TwMergeCodegenHeader } from "./header";
import { formatObjectKey } from "./names";

/**
 * The generated tailwind-merge config file (`codegen.twMerge`): the config
 * derived from the system's Tailwind CSS, exported as `twMergeConfig` for
 * tailwind-variants' `createTV({ twMergeConfig })`, and `twMerge` built
 * from it. Pure: the caller derives the config and writes the file.
 */

export type GeneratedTwMergeFile = {
	fileName: string;
	header: TwMergeCodegenHeader;
	contents: string;
};

const INDENT = "\t";

/** `key: { group: ["value", …], … },` at `indent`, one value per line. */
const formatGroups = (
	key: string,
	groups: Readonly<Record<string, readonly string[] | undefined>>,
	indent: string,
): string[] => {
	const entries = Object.entries(groups).filter(
		(entry): entry is [string, readonly string[]] => entry[1] !== undefined,
	);
	if (entries.length === 0) return [`${indent}${key}: {},`];
	const inner = indent + INDENT;
	return [
		`${indent}${key}: {`,
		...entries.flatMap(([group, values]) => [
			`${inner}${formatObjectKey(group)}: [`,
			...values.map((value) => `${inner}${INDENT}${JSON.stringify(value)},`),
			`${inner}],`,
		]),
		`${indent}},`,
	];
};

export const hashTwMergeSource = (derived: DerivedTwMerge) =>
	`sha256:${sha256Hex(stableStringify(derived))}`;

export function generateTwMergeFile({
	derived,
	systemId,
	fileName,
}: {
	derived: DerivedTwMerge;
	systemId: string;
	fileName: string;
}): GeneratedTwMergeFile {
	const header: TwMergeCodegenHeader = {
		version: 1,
		kind: "tw-merge",
		systemId,
		sourceHash: hashTwMergeSource(derived),
	};
	const level = INDENT.repeat(2);
	const unclassified = derived.unclassified.map(
		({ utility, properties }) =>
			`//   ${utility}${properties.length > 0 ? ` (${properties.join(", ")})` : " (custom properties only)"}`,
	);
	const contents = [
		formatTwMergeHeader(header),
		"",
		'import { extendTailwindMerge } from "tailwind-merge";',
		"",
		"// tailwind-merge config derived from the design system's Tailwind CSS: theme",
		"// keys per namespace, and custom utilities by the CSS properties they set.",
		"// Pass twMergeConfig to createTV so tv() merges like twMerge.",
		...(unclassified.length > 0
			? [
					"// Custom utilities that match no single class group, kept as they are:",
					...unclassified,
				]
			: []),
		"export const twMergeConfig = {",
		`${INDENT}extend: {`,
		...formatGroups("theme", derived.config.extend.theme, level),
		...formatGroups("classGroups", derived.config.extend.classGroups, level),
		`${INDENT}},`,
		"} as const;",
		"",
		"export const twMerge = extendTailwindMerge(twMergeConfig);",
		"",
	];
	return { fileName, header, contents: contents.join("\n") };
}
