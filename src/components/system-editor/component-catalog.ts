import type { SystemComponentSummary } from "../../queries/system-components";
import { slugifyComponentName } from "../../utils/system-components";

export type ComponentPublicationState =
	| "draft-only"
	| "published-only"
	| "draft-over-published";

export type ComponentGroupSection = {
	group: string;
	components: SystemComponentSummary[];
};

export function getComponentPublicationState(
	summary: SystemComponentSummary,
): ComponentPublicationState {
	if (summary.hasDraft && summary.hasPublished) {
		return "draft-over-published";
	}
	return summary.hasPublished ? "published-only" : "draft-only";
}

export function groupComponentsByGroup(
	components: readonly SystemComponentSummary[],
): ComponentGroupSection[] {
	const grouped = new Map<string, SystemComponentSummary[]>();

	for (const component of components) {
		const group = component.group?.trim() || "Ungrouped";
		const rows = grouped.get(group) ?? [];
		rows.push(component);
		grouped.set(group, rows);
	}

	return [...grouped.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([group, groupComponents]) => ({
			group,
			components: [...groupComponents].sort((left, right) => {
				const orderDelta =
					(left.order ?? Number.MAX_SAFE_INTEGER) -
					(right.order ?? Number.MAX_SAFE_INTEGER);
				if (orderDelta !== 0) {
					return orderDelta;
				}
				return left.name.localeCompare(right.name);
			}),
		}));
}

export { slugifyComponentName };

export function nextUniqueComponentSlug(
	baseSlug: string,
	components: readonly SystemComponentSummary[],
) {
	const taken = new Set(components.map((component) => component.slug));
	if (!taken.has(baseSlug)) {
		return baseSlug;
	}

	for (let index = 2; index < 1000; index += 1) {
		const candidate = `${baseSlug}-${index}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}

	return `${baseSlug}-${Date.now()}`;
}
