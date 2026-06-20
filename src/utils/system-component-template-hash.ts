import type { RecipeTemplateNode } from "../types";
import type { SystemComponentDraftPayload } from "./system-components";

const stableStringify = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
};

const fnv1a32 = (input: string, seed: number) => {
	let hash = seed >>> 0;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
};

export function stableSystemComponentTemplateInput(
	payload: Pick<
		SystemComponentDraftPayload,
		"root" | "slots" | "overrideTargets"
	>,
): string {
	return stableStringify({
		root: payload.root,
		slots: payload.slots ?? {},
		overrideTargets: payload.overrideTargets ?? {},
	});
}

export function hashComponentDraftSnapshot(
	payload: Pick<
		SystemComponentDraftPayload,
		"root" | "slots" | "overrideTargets"
	>,
): string {
	const input = stableSystemComponentTemplateInput(payload);
	return `client-fnv:${fnv1a32(input, 0x811c9dc5)}${fnv1a32(input, 0x9e3779b9)}`;
}

export type ComponentDraftTemplateSnapshot = {
	root: RecipeTemplateNode;
	slots?: SystemComponentDraftPayload["slots"];
	overrideTargets?: SystemComponentDraftPayload["overrideTargets"];
};
