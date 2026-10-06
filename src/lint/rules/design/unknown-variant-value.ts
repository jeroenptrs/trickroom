import type {
	SystemContractComponent,
	SystemContractVersion,
} from "../../contract";
import type { LintDesignUsage } from "../../designs";
import type { LintRuleFinding, LintRuleKind } from "../types";

/**
 * An instance of a component in a design records a variant value its
 * version's axis does not have, or names an axis that version does not
 * have. An instance is checked against the published version it uses;
 * when that version is not in the manifest, against the current one. When
 * an instance pinned to an older version is wrong there but right in the
 * current version, the message says the fix is to migrate it.
 */

export const UNKNOWN_VARIANT_VALUE_RULE_ID = "design.unknown-variant-value";

const quoteList = (values: readonly string[]) =>
	values.length === 0 ? "none" : values.map((value) => `"${value}"`).join(", ");

const axisOf = (version: SystemContractVersion | undefined, key: string) =>
	version?.axes.find((axis) => axis.key === key);

const checkUsage = (
	component: SystemContractComponent,
	usage: LintDesignUsage,
): LintRuleFinding[] => {
	const current = component.versions.find(
		(entry) => entry.version === component.publishedVersion,
	);
	const used = component.versions.find(
		(entry) => entry.version === usage.version,
	);
	const checked = used ?? current;
	if (!checked) return [];
	const pinned = used !== undefined && used !== current ? used : null;
	const subject = pinned
		? `Instance of "${component.slug}" (pinned to version ${pinned.version}; current is ${component.publishedVersion})`
		: `Instance of "${component.slug}"`;
	const fallback = used
		? ""
		: ` Its version "${usage.version}" is not in the manifest, so it was checked against the current version ${checked.version}.`;
	const migrate = `Migrate the instance to version ${component.publishedVersion}, which has it.`;

	const findings: LintRuleFinding[] = [];
	for (const [axisKey, value] of Object.entries(usage.variantValues).sort(
		([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
	)) {
		const axis = axisOf(checked, axisKey);
		const currentAxis = pinned ? axisOf(current, axisKey) : undefined;
		let message: string;
		if (!axis) {
			message = `${subject} sets variant axis "${axisKey}" (to "${value}"), which version ${checked.version} does not have.${fallback} ${
				currentAxis?.values.includes(value)
					? migrate
					: `Remove it; the axes are ${quoteList(checked.axes.map((entry) => entry.key))}.`
			}`;
		} else if (!axis.values.includes(value)) {
			message = `${subject} sets "${axisKey}" to "${value}", which version ${checked.version} does not have.${fallback} ${
				currentAxis?.values.includes(value)
					? migrate
					: `Pick one of ${quoteList(axis.values)}.`
			}`;
		} else {
			continue;
		}
		findings.push({
			message,
			location: {
				kind: "design",
				design: usage.design,
				board: usage.board,
				element: usage.element,
				path: usage.path,
			},
			component: component.slug,
			details: {
				axis: axisKey,
				value,
				version: usage.version,
				...(pinned ? { currentVersion: component.publishedVersion } : {}),
			},
		});
	}
	return findings;
};

export const designUnknownVariantValueRule: LintRuleKind = {
	id: UNKNOWN_VARIANT_VALUE_RULE_ID,
	side: "design",
	defaultSeverity: "error",
	description:
		"An instance of a component in a design records a variant value, or a variant axis, that the published version it uses does not have.",
	run: ({ contract, designs }) => {
		const findings: LintRuleFinding[] = [];
		for (const component of contract.components) {
			if (component.publishedVersion === null) continue;
			for (const usage of designs.usages[component.componentId] ?? []) {
				findings.push(...checkUsage(component, usage));
			}
		}
		return findings;
	},
};
