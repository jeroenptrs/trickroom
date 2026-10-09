import {
	createCanonicalClassChecker,
	NON_CANONICAL_CLASS_OPTIONS,
	noCompiledCssNote,
	nonCanonicalClassDetails,
	nonCanonicalClassMessage,
} from "../canonical-classes";
import type { LintRuleFinding, LintRuleKind } from "../types";
import { classTokenPosition, codeLocation, getCodeAnalysis } from "./analysis";

/**
 * Class strings in the scanned sources that Tailwind writes differently:
 * `bg-[#FFF]` for `bg-white`, `[&:has(.x)]:p-2` for `has-[.x]:p-2`. The
 * canonical form is a property of the class alone, so a literal next to
 * non-literal parts (`mixed`) is checked; template fragments
 * (`complete: false`) are not, since a class may continue across the
 * interpolation. Generated variants files are codegen's output and skipped.
 */

export const nonCanonicalClassRule: LintRuleKind = {
	id: "code.non-canonical-class",
	side: "code",
	defaultSeverity: "warning",
	description:
		"A class string uses a class Tailwind writes differently (an arbitrary value or variant with a named equivalent, a renamed utility); the finding names the canonical form.",
	options: NON_CANONICAL_CLASS_OPTIONS,
	run: async (context) => {
		const check = createCanonicalClassChecker(
			await context.tailwind.inspector(),
			context.rule.options,
		);
		if (!check) return [noCompiledCssNote];

		const findings: LintRuleFinding[] = [];
		const { sources } = context;
		const wrapperSlug = new Map<string, string>();
		for (const [slug, files] of getCodeAnalysis(context).wrappers) {
			for (const file of files) {
				if (!wrapperSlug.has(file)) wrapperSlug.set(file, slug);
			}
		}
		for (const file of sources.files) {
			if (sources.generated[file] !== undefined) continue;
			const slug = wrapperSlug.get(file);
			for (const entry of sources.modules[file].classStrings) {
				if (!entry.complete) continue;
				for (const found of check(entry.value)) {
					findings.push({
						...(slug ? { component: slug } : {}),
						location: codeLocation(
							file,
							classTokenPosition(entry, found.classToken, found.occurrence),
						),
						message: `${nonCanonicalClassMessage(found)} Use "${found.canonical}", or add "${found.classToken}" to this rule's allow list if it is intended.`,
						details: nonCanonicalClassDetails(entry.value, found),
					});
				}
			}
		}
		return findings;
	},
};
