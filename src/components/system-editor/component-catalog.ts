import type { SystemComponentSummary } from "../../queries/system-components";
import { slugifyComponentName } from "../../utils/system-components";

export type ComponentPublicationState =
	| "draft-only"
	| "published-only"
	| "draft-over-published";

export function getComponentPublicationState(
	summary: SystemComponentSummary,
): ComponentPublicationState {
	if (summary.hasDraft && summary.hasPublished) {
		return "draft-over-published";
	}
	return summary.hasPublished ? "published-only" : "draft-only";
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
