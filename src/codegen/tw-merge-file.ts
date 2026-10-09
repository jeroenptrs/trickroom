import { sha256Hex } from "../utils/sha256";
import { stableStringify } from "../utils/system-component-template-hash";
import type { DerivedTwMerge } from "../utils/tailwind-merge-derive";
import { formatTwMergeHeader, type TwMergeCodegenHeader } from "./header";
import { formatObjectKey } from "./names";

/**
 * The generated tailwind-merge config file (`codegen.twMerge`): the config
 * derived from the system's Tailwind CSS, exported as `twMergeConfig` for
 * tailwind-variants' `createTV({ twMergeConfig })`, and `twMerge` built
 * from it. Its own class groups are not tailwind-merge's, hence
 * `extendTailwindMerge<string>`. Pure: the caller derives the config and
 * writes the file.
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
	const { config } = derived;
	const contents = [
		formatTwMergeHeader(header),
		"",
		'import { extendTailwindMerge } from "tailwind-merge";',
		"",
		"// tailwind-merge config derived from the design system's Tailwind CSS. Theme keys",
		"// list each namespace. A custom utility that sets exactly what a stock class",
		"// group sets joins that group; every other one gets a group of its own",
		'// ("@utility …"), which stock classes never remove, and conflicts with the',
		"// groups whose every declaration it overrides, so a later one removes them.",
		...(Object.keys(config.extend.classGroups).some((id) =>
			id.startsWith("mergeGroups."),
		)
			? [
					'// "mergeGroups.…" groups are codegen.twMerge.mergeGroups in .trickroom/config.json:',
					"// the project declares their members interchangeable, so the last one wins.",
				]
			: []),
		"// Pass twMergeConfig to createTV so tv() merges like twMerge.",
		"export const twMergeConfig = {",
		...(config.prefix
			? [`${INDENT}prefix: ${JSON.stringify(config.prefix)},`]
			: []),
		`${INDENT}extend: {`,
		...formatGroups("theme", config.extend.theme, level),
		...formatGroups("classGroups", config.extend.classGroups, level),
		...formatGroups(
			"conflictingClassGroups",
			config.extend.conflictingClassGroups,
			level,
		),
		`${INDENT}},`,
		"} as const;",
		"",
		"export const twMerge = extendTailwindMerge<string>(twMergeConfig);",
		"",
	];
	return { fileName, header, contents: contents.join("\n") };
}
