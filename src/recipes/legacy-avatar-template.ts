import baseUiRecipes from "../libraries/base-ui/recipes";
import type { RecipeDefinition } from "../types";

// TODO 331: Avatar legacy migration fixture
// Scope touched:
// - src/recipes/legacy-avatar-template.ts
// - src/recipes/recipes.test.ts
// - src/mcp/design-read-tools.test.ts
// - src/mcp/mutations.test.ts
// Keep helper deterministic by avoiding duplicate legacy install when 0.9 already exists.
// Verified with:
// - pnpm exec vitest run src/recipes/recipes.test.ts src/mcp/mutations.test.ts src/mcp/design-read-tools.test.ts
// - pnpm exec tsc --noEmit
// - pnpm exec biome check src/libraries/base-ui/recipes.ts src/recipes/recipes.test.ts src/mcp/mutations.test.ts src/mcp/design-read-tools.test.ts

export const legacyAvatarDefaultTemplate = {
	version: "0.9",
	description: "Avatar template with the legacy fallback path.",
	root: {
		path: "root",
		library: "base-ui",
		component: "avatar.root",
		children: [
			{
				path: "legacy-fallback",
				library: "base-ui",
				component: "avatar.fallback",
				slot: "fallback",
				children: [],
			},
		],
	},
	slots: {
		fallback: {
			name: "fallback",
			label: "Fallback",
			hostPath: "legacy-fallback",
		},
	},
} satisfies NonNullable<RecipeDefinition["previousTemplates"]>[number];

export const installAvatarLegacyPreviousTemplate = (): (() => void) => {
	const avatarRecipe = baseUiRecipes["avatar.default"] as RecipeDefinition;
	const previousTemplates = avatarRecipe.previousTemplates ?? [];
	const isLegacyAlreadyInstalled = previousTemplates.some(
		(template) =>
			template.version === legacyAvatarDefaultTemplate.version &&
			template.root.path === legacyAvatarDefaultTemplate.root.path &&
			template.slots?.fallback?.hostPath ===
				legacyAvatarDefaultTemplate.slots.fallback.hostPath,
	);
	if (!isLegacyAlreadyInstalled) {
		avatarRecipe.previousTemplates = [
			...previousTemplates,
			legacyAvatarDefaultTemplate,
		];
	}
	return () => {
		avatarRecipe.previousTemplates = previousTemplates;
	};
};
