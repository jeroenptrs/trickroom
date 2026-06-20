import type { RecipeTemplateNode } from "../types";
import {
	createEmptySystemComponentManifest,
	SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	type SystemComponentManifest,
	type SystemComponentRecord,
} from "./system-components";
import {
	hashSystemComponentTemplate,
	hashSystemComponentVariantSchema,
} from "./system-components-validation";

export const FIXTURE_COMPONENT_ID =
	"cmp_11111111-1111-4111-8111-111111111111";

export const FIXTURE_OTHER_COMPONENT_ID =
	"cmp_22222222-2222-4222-8222-222222222222";

export const minimalComponentTemplateRoot = (): RecipeTemplateNode => ({
	path: "root",
	library: "trickroom",
	component: "container",
});

export const complexComponentTemplateRoot = (): RecipeTemplateNode => ({
	path: "root",
	library: "trickroom",
	component: "container",
	children: [
		{
			path: "label",
			library: "trickroom",
			component: "text",
			text: "Label",
		},
		{
			path: "icon",
			library: "trickroom",
			component: "icon",
		},
	],
});

export const createFixtureComponentRecord = (
	overrides: Partial<SystemComponentRecord> = {},
): SystemComponentRecord => ({
	componentId: FIXTURE_COMPONENT_ID,
	slug: "primary-button",
	name: "Primary Button",
	createdAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	updatedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
	draft: {
		root: minimalComponentTemplateRoot(),
	},
	...overrides,
});

export const createFixtureManifest = (
	components: Record<string, SystemComponentRecord>,
): SystemComponentManifest => ({
	...createEmptySystemComponentManifest(),
	components,
});

export const createFixturePublishedRecord = (
	overrides: Partial<SystemComponentRecord> = {},
): SystemComponentRecord => {
	const draft = {
		root: complexComponentTemplateRoot(),
		slots: {
			default: {
				name: "default",
				hostPath: "root",
			},
		},
		variants: {
			axes: {
				tone: {
					label: "Tone",
					defaultValue: "neutral",
					values: {
						brand: { classesByPath: { root: "text-blue-600" } },
						neutral: { classesByPath: { root: "text-zinc-700" } },
					},
				},
			},
		},
		overrideTargets: {
			rootTarget: { targetId: "rootTarget", label: "Root", path: "root" },
		},
	};
	const templateHash = hashSystemComponentTemplate(draft);
	const variantSchemaHash = hashSystemComponentVariantSchema(draft.variants);

	return createFixtureComponentRecord({
		draft,
		published: {
			currentVersion: "1",
			versions: {
				"1": {
					...draft,
					version: "1",
					publishedAt: SYSTEM_COMPONENT_EMPTY_TIMESTAMP,
					templateHash,
					variantSchemaHash,
				},
			},
		},
		...overrides,
	});
};
