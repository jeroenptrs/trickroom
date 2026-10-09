import { createClassMerge } from "../../../utils/class-merge";
import type { SystemContractComponent } from "../../contract";
import type { SourceClassString, SourcePosition } from "../../source/parse";
import {
	type ClassContext,
	createCanonicalClassChecker,
	mergeTreatsAlike,
	NON_CANONICAL_CLASS_OPTIONS,
	type NonCanonicalClass,
	noCompiledCssNote,
	nonCanonicalClassDetails,
	nonCanonicalClassMessage,
	settleInContext,
} from "../canonical-classes";
import type { LintRuleContext, LintRuleFinding, LintRuleKind } from "../types";
import { classTokenPosition, codeLocation, getCodeAnalysis } from "./analysis";

/**
 * Class strings in the scanned sources that Tailwind writes differently:
 * `bg-[#FFF]` for `bg-white`, `[&:has(.x)]:p-2` for `has-[.x]:p-2`. The
 * canonical form is a property of the class alone, so a literal next to
 * non-literal parts (`mixed`) is checked; template fragments
 * (`complete: false`) are not, since a class may continue across the
 * interpolation. Generated variants files are codegen's output and skipped.
 * A canonical form is reported only when it compiles to the class's CSS
 * (see `createCanonicalClassChecker`).
 *
 * Each finding is then settled among the classes that may render with it
 * (`settleInContext`): every literal of the class string it sits in (one
 * `className` attribute or class call, conditional parts included), plus,
 * for the `className` of a bound component, every class the component
 * declares on its root slot. That context is complete only for a
 * `className` with nothing but literals, on an intrinsic element or a bound
 * component, that no later spread may replace. Classes may be merged on the
 * way (tv() merges, a `cn()` may), so a form tailwind-merge treats
 * differently in that context is not reported.
 */

const classesOf = (className: string) =>
	className.split(/\s+/u).filter(Boolean);

const samePosition = (left: SourcePosition, right: SourcePosition) =>
	left.line === right.line && left.column === right.column;

const isAfter = (left: SourcePosition, right: SourcePosition) =>
	left.line > right.line ||
	(left.line === right.line && left.column > right.column);

/** Every class a bound component declares on its root slot, as if all applied. */
const rootSlotClasses = (component: SystemContractComponent) => {
	const root = component.slots.find((slot) => slot.key === "root");
	const slotClasses = (classes: ReadonlyArray<[string, string]>) =>
		classes
			.filter(([slot]) => slot === "root")
			.flatMap(([, className]) => classesOf(className));
	return [
		...classesOf(root?.className ?? ""),
		...component.axes.flatMap((axis) =>
			axis.values.flatMap((value) => slotClasses(value.classes)),
		),
		...component.compounds.flatMap((compound) => slotClasses(compound.classes)),
	];
};

const contextFor = (
	context: LintRuleContext,
	file: string,
	entry: SourceClassString,
	group: readonly SourceClassString[],
	merge: ((className: string) => string) | null,
): ClassContext => {
	const { sources } = context;
	let classes = group.flatMap((part) => classesOf(part.value));
	let complete =
		merge !== null && group.every((part) => part.complete && !part.mixed);
	if (entry.origin.kind === "call") {
		// Where a class call's result goes is not followed.
		complete = false;
	} else {
		const element = sources.modules[file].jsx.find((candidate) =>
			candidate.attributes.some(
				(attribute) =>
					attribute.name === "className" &&
					samePosition(attribute.position, entry.expression),
			),
		);
		if (
			!element ||
			element.spreads.some((spread) => isAfter(spread, entry.expression))
		) {
			complete = false;
		} else if (!/^[a-z]/u.test(element.name) || element.name.includes(".")) {
			const usage = sources.usages.find(
				(candidate) =>
					candidate.file === file &&
					samePosition(candidate.element.position, element.position),
			);
			const component = usage
				? getCodeAnalysis(context).components.get(usage.slug)
				: undefined;
			if (component && component.shape !== null) {
				classes = [...rootSlotClasses(component), ...classes];
			} else {
				// Another component may add classes of its own.
				complete = false;
			}
		}
	}
	const className = classes.join(" ");
	return {
		classes,
		complete,
		...(merge
			? {
					mergesAlike: (classToken: string, canonical: string) =>
						mergeTreatsAlike(merge, className, classToken, canonical),
				}
			: {}),
	};
};

export const nonCanonicalClassRule: LintRuleKind = {
	id: "code.non-canonical-class",
	side: "code",
	defaultSeverity: "warning",
	description:
		"A class string uses a class Tailwind writes differently (an arbitrary value or variant with a named equivalent, a renamed utility); the finding names the canonical form.",
	options: NON_CANONICAL_CLASS_OPTIONS,
	run: async (context) => {
		const { sources } = context;
		const checked = sources.files
			.filter((file) => sources.generated[file] === undefined)
			.flatMap((file) =>
				sources.modules[file].classStrings
					.filter((entry) => entry.complete)
					.map((entry) => ({ file, entry })),
			);
		const inspector = await context.tailwind.inspector();
		const check = await createCanonicalClassChecker(
			inspector,
			context.rule.options,
			checked.map(({ entry }) => entry.value),
		);
		if (!check) return [noCompiledCssNote];

		const pending: Array<{
			file: string;
			entry: SourceClassString;
			found: NonCanonicalClass;
		}> = [];
		for (const { file, entry } of checked) {
			for (const found of check(entry.value)) {
				pending.push({ file, entry, found });
			}
		}
		if (pending.length === 0) return [];

		const mergeConfig = await context.tailwind.mergeConfig();
		// Unknown merging (the derived config failed): no context is complete.
		const merge =
			mergeConfig.status === "failed"
				? null
				: createClassMerge(
						mergeConfig.status === "derived"
							? { mode: "derived", config: mergeConfig.config }
							: { mode: "stock" },
					);
		const groupKey = (file: string, position: SourcePosition) =>
			`${file}\u0000${position.line}:${position.column}`;
		const groups = new Map<string, SourceClassString[]>();
		for (const file of sources.files) {
			for (const entry of sources.modules[file].classStrings) {
				const key = groupKey(file, entry.expression);
				groups.set(key, [...(groups.get(key) ?? []), entry]);
			}
		}
		const contexts = new Map<SourceClassString, ClassContext>();
		const settled = await settleInContext(
			inspector,
			pending.map(({ file, entry, found }) => {
				let classContext = contexts.get(entry);
				if (!classContext) {
					classContext = contextFor(
						context,
						file,
						entry,
						groups.get(groupKey(file, entry.expression)) ?? [entry],
						merge,
					);
					contexts.set(entry, classContext);
				}
				return { found, context: classContext };
			}),
		);

		const findings: LintRuleFinding[] = [];
		const wrapperSlug = new Map<string, string>();
		for (const [slug, files] of getCodeAnalysis(context).wrappers) {
			for (const file of files) {
				if (!wrapperSlug.has(file)) wrapperSlug.set(file, slug);
			}
		}
		pending.forEach(({ file, entry }, index) => {
			const found = settled[index];
			if (!found) return;
			const slug = wrapperSlug.get(file);
			findings.push({
				...(slug ? { component: slug } : {}),
				location: codeLocation(
					file,
					classTokenPosition(entry, found.classToken, found.occurrence),
				),
				message: `${nonCanonicalClassMessage(found)} Use "${found.canonical}"${found.themeVariables.length > 0 ? " if the value should follow the theme" : ""}, or add "${found.classToken}" to this rule's allow list if it is intended.`,
				details: nonCanonicalClassDetails(entry.value, found),
			});
		});
		return findings;
	},
};
