import { compileGlobs } from "../../source/glob";
import type { SourceIndex } from "../../source/index";
import type { SourcePosition } from "../../source/parse";
import type { LintRuleFinding, LintRuleKind } from "../types";
import {
	codeLocation,
	componentWrappers,
	conventionalWrapper,
	getCodeAnalysis,
	optionsNote,
} from "./analysis";

/**
 * Who may touch a component's styling. Importing the generated file means
 * "I am the component"; everyone else borrows the styling through a
 * re-export from the wrapper (docs/proposals/design-system-lint.md,
 * "Component identity").
 */

const importPosition = (
	sources: SourceIndex,
	file: string,
	targets: readonly string[],
): SourcePosition | undefined =>
	sources.modules[file]?.imports.find(
		(entry) =>
			entry.resolved !== null &&
			targets.includes(entry.resolved) &&
			entry.names.some((name) => !name.type),
	)?.position;

export const variantsImportedOutsideComponentRule: LintRuleKind = {
	id: "code.variants-imported-outside-component",
	side: "code",
	defaultSeverity: "error",
	description:
		"A module other than the component's wrapper imports its generated variants file; other modules borrow the styling through a re-export from the wrapper.",
	run: (context) => {
		const { sources } = context;
		const analysis = getCodeAnalysis(context);
		const findings: LintRuleFinding[] = [];
		for (const identity of sources.components) {
			if (identity.generatedFiles.length === 0) continue;
			const generated = identity.generatedFiles.join(", ");
			const configured = identity.configuredWrappers.length > 0;
			let outsiders: string[];
			let wrapper: string | null;
			if (configured) {
				const implementations = analysis.wrappers.get(identity.slug) ?? [];
				outsiders = identity.importers.filter(
					(file) => !implementations.includes(file),
				);
				const via = implementations.filter(
					(file) => !identity.configuredWrappers.includes(file),
				);
				wrapper = `${identity.configuredWrappers.join(", ")}${via.length > 0 ? ` (implemented by ${via.join(", ")})` : ""}`;
			} else {
				if (identity.importers.length < 2) continue;
				wrapper = conventionalWrapper(identity.slug, identity);
				outsiders = identity.importers.filter((file) => file !== wrapper);
			}
			for (const file of outsiders) {
				findings.push({
					component: identity.slug,
					location: codeLocation(
						file,
						importPosition(sources, file, identity.generatedFiles),
					),
					message: configured
						? `${file} imports ${generated} directly, but lint.json names ${wrapper} as the "${identity.slug}" component. Import the styling from the wrapper (re-export it there) instead.`
						: wrapper
							? `${file} imports ${generated} directly, but ${wrapper} is the "${identity.slug}" component. Import the styling from the wrapper (re-export it there) instead.`
							: `${file} is one of ${identity.importers.length} modules importing ${generated} directly (${identity.importers.join(", ")}), so it is unclear which is the "${identity.slug}" component. Keep one direct importer and re-export the styling from it, or set components.${identity.slug}.module in lint.json.`,
				});
			}
		}
		return findings;
	},
};

const RESTRICTED_ID = "code.component-styling-restricted";

const readRestrictions = (
	options: Record<string, unknown>,
	slugs: ReadonlySet<string>,
) => {
	const problems: string[] = [];
	const restrictions = new Map<string, string[]>();
	for (const key of Object.keys(options)) {
		if (key !== "components") {
			problems.push(
				`"${key}" is not an option of this rule (components); ignored.`,
			);
		}
	}
	const components = options.components;
	if (components === undefined) return { restrictions, problems };
	if (
		typeof components !== "object" ||
		components === null ||
		Array.isArray(components)
	) {
		problems.push(
			'"components" must map component slugs to { allowIn }; ignored.',
		);
		return { restrictions, problems };
	}
	for (const [slug, entry] of Object.entries(components)) {
		const allowIn = (entry as { allowIn?: unknown } | null)?.allowIn;
		if (
			!Array.isArray(allowIn) ||
			!allowIn.every((glob) => typeof glob === "string")
		) {
			problems.push(
				`components.${slug}.allowIn must be a list of file globs; "${slug}" is not restricted.`,
			);
			continue;
		}
		if (!slugs.has(slug)) {
			problems.push(
				`components.${slug}: the system has no component "${slug}".`,
			);
			continue;
		}
		restrictions.set(slug, allowIn as string[]);
	}
	return { restrictions, problems };
};

export const componentStylingRestrictedRule: LintRuleKind = {
	id: RESTRICTED_ID,
	side: "code",
	defaultSeverity: "warning",
	description:
		"Configurable: a component's variants export or slot functions are used outside the files its options allow. Does nothing until options name components.",
	run: (context) => {
		const analysis = getCodeAnalysis(context);
		const { restrictions, problems } = readRestrictions(
			context.rule.options,
			new Set(analysis.components.keys()),
		);
		const findings: LintRuleFinding[] = [];
		if (problems.length > 0)
			findings.push(optionsNote(RESTRICTED_ID, problems));
		if (restrictions.size === 0) return findings;
		const matchers = new Map(
			[...restrictions].map(([slug, globs]) => [slug, compileGlobs(globs)]),
		);
		const ownWrappers = new Map(
			[...restrictions.keys()].map((slug) => {
				const identity = analysis.identities.get(slug);
				return [slug, identity ? componentWrappers(analysis, identity) : []];
			}),
		);
		for (const [file, variants] of analysis.modules) {
			for (const [slug, allowed] of matchers) {
				if (allowed(file)) continue;
				// Styling a component in its own wrapper is the point.
				if (ownWrappers.get(slug)?.includes(file)) continue;
				const calls = [
					...variants.calls.filter((entry) => entry.slug === slug),
					...variants.slotCalls.filter((entry) => entry.slug === slug),
				].sort(
					(left, right) =>
						left.call.position.line - right.call.position.line ||
						left.call.position.column - right.call.position.column,
				);
				const imported = variants.imports.find((entry) => entry.slug === slug);
				if (calls.length === 0 && !imported) continue;
				const component = analysis.components.get(slug);
				const exportName = component?.exportName ?? slug;
				const globs = restrictions.get(slug) ?? [];
				const where =
					globs.length > 0
						? `${globs.join(", ")} and the component's wrapper`
						: "the component's wrapper";
				findings.push({
					component: slug,
					location: codeLocation(
						file,
						calls[0]?.call.position ?? imported?.position,
					),
					message: `${file} uses the styling of "${slug}" (${exportName}${calls.length > 0 ? `, ${calls.length} call${calls.length === 1 ? "" : "s"}` : ", imported"}), which this rule allows only in ${where}. Render the component instead, or add the file to allowIn.`,
				});
			}
		}
		return findings;
	},
};
