import type { SystemContractComponent } from "../../contract";
import type { SourceCall, SourceObjectArgument } from "../../source/parse";
import type { LintRuleContext, LintRuleFinding, LintRuleKind } from "../types";
import {
	axisAccepts,
	type CodeAnalysis,
	codeLocation,
	describeAxisValues,
	getCodeAnalysis,
	isComponentUsage,
	literalVariantKey,
	objectArgument,
	spreadFollows,
} from "./analysis";

/**
 * Variant props against the contract's axes: on JSX usages of the
 * component (`<Button variant="danger">`) and in literal objects passed to
 * the variants export or a slot function (`buttonVariants({ size: "xl" })`).
 * Only literal values are judged; dynamic values and attributes that are
 * not axes are left alone. JSX checks apply to the component's own export,
 * not to the other parts its wrapper exports (see `isComponentUsage`).
 */

type CallSite = { file: string; slug: string; call: SourceCall; slot?: string };

const callSites = (analysis: CodeAnalysis, slots: boolean): CallSite[] => {
	const sites: CallSite[] = [];
	for (const [file, variants] of analysis.modules) {
		for (const entry of variants.calls) {
			sites.push({ file, slug: entry.slug, call: entry.call });
		}
		if (!slots) continue;
		for (const entry of variants.slotCalls) {
			sites.push({
				file,
				slug: entry.slug,
				call: entry.call,
				slot: entry.slot,
			});
		}
	}
	return sites;
};

/** A property a later spread may override is not a reliable literal. */
const overriddenBySpread = (argument: SourceObjectArgument, key: string) => {
	const index = argument.members.findLastIndex(
		(member) => member.kind === "property" && member.key === key,
	);
	return argument.members
		.slice(index + 1)
		.some((member) => member.kind !== "property");
};

const usableComponent = (
	analysis: CodeAnalysis,
	slug: string,
): SystemContractComponent | null => {
	const component = analysis.components.get(slug);
	return component && component.shape !== null ? component : null;
};

const describeCall = (site: CallSite, component: SystemContractComponent) =>
	site.slot ? `the "${site.slot}" slot call` : `${component.exportName}(…)`;

export const unknownVariantValueRule: LintRuleKind = {
	id: "code.unknown-variant-value",
	side: "code",
	defaultSeverity: "error",
	description:
		"A JSX attribute or a variants call passes a literal value the component's axis does not have.",
	run: (context: LintRuleContext) => {
		const analysis = getCodeAnalysis(context);
		const findings: LintRuleFinding[] = [];
		for (const usage of context.sources.usages) {
			const component = usableComponent(analysis, usage.slug);
			if (!component) continue;
			if (!isComponentUsage(context.sources, component, usage)) continue;
			for (const attribute of usage.element.attributes) {
				const axis = component.axes.find(
					(entry) => entry.key === attribute.name,
				);
				// A later spread may override the literal: not a known value.
				if (!axis || spreadFollows(usage.element, attribute.position)) continue;
				const key = literalVariantKey(attribute.value);
				if (key === null || axisAccepts(axis, key)) continue;
				findings.push({
					component: component.slug,
					location: codeLocation(usage.file, attribute.position),
					message: `<${usage.element.name} ${axis.key}="${key}"> passes a value axis "${axis.key}" of "${component.slug}" does not have (expected ${describeAxisValues(axis)}). Use one of those, or add the value to the component in the system.`,
				});
			}
		}
		for (const site of callSites(analysis, true)) {
			const component = usableComponent(analysis, site.slug);
			const argument = objectArgument(site.call.arguments[0]);
			if (!component || !argument) continue;
			for (const key of argument.keys) {
				const axis = component.axes.find((entry) => entry.key === key);
				if (!axis || overriddenBySpread(argument, key)) continue;
				const value = argument.properties[key];
				const valueKey = value ? literalVariantKey(value) : null;
				if (valueKey === null || axisAccepts(axis, valueKey)) continue;
				findings.push({
					component: component.slug,
					location: codeLocation(site.file, site.call.position),
					message: `${describeCall(site, component)} passes ${axis.key}: "${valueKey}", a value axis "${axis.key}" of "${component.slug}" does not have (expected ${describeAxisValues(axis)}). Use one of those, or add the value to the component in the system.`,
				});
			}
		}
		return findings;
	},
};

export const requiredAxisMissingRule: LintRuleKind = {
	id: "code.required-axis-missing",
	side: "code",
	defaultSeverity: "error",
	description:
		"A usage or a variants call omits an axis that has no default (and is not boolean).",
	run: (context: LintRuleContext) => {
		const analysis = getCodeAnalysis(context);
		const findings: LintRuleFinding[] = [];
		for (const usage of context.sources.usages) {
			const component = usableComponent(analysis, usage.slug);
			if (!component || usage.element.spread) continue;
			const required = component.axes.filter((axis) => axis.required);
			if (required.length === 0) continue;
			if (!isComponentUsage(context.sources, component, usage)) continue;
			for (const axis of required) {
				if (
					usage.element.attributes.some(
						(attribute) => attribute.name === axis.key,
					)
				)
					continue;
				findings.push({
					component: component.slug,
					location: codeLocation(usage.file, usage.element.position),
					message: `<${usage.element.name}> omits "${axis.key}", a required axis of "${component.slug}" (no default; expected ${describeAxisValues(axis)}). Pass it, or give the axis a default in the system.`,
				});
			}
		}
		for (const site of callSites(analysis, false)) {
			const component = usableComponent(analysis, site.slug);
			if (!component) continue;
			const required = component.axes.filter((axis) => axis.required);
			if (required.length === 0) continue;
			const first = site.call.arguments[0];
			const argument = objectArgument(first);
			// A non-literal argument (`props`) may carry anything.
			if (first !== undefined && !argument) continue;
			if (argument && (argument.hasSpread || argument.hasComputed)) continue;
			const keys = new Set(argument?.keys ?? []);
			for (const axis of required) {
				if (keys.has(axis.key)) continue;
				findings.push({
					component: component.slug,
					location: codeLocation(site.file, site.call.position),
					message: `${component.exportName}(…) omits "${axis.key}", a required axis of "${component.slug}" (no default; expected ${describeAxisValues(axis)}). Pass it, or give the axis a default in the system.`,
				});
			}
		}
		return findings;
	},
};
