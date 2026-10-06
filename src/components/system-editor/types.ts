export type SystemEditorPage =
	| "components"
	| "tokens"
	| "assets"
	| "icons"
	| "lint";

export const pageTitleByTab: Record<SystemEditorPage, string> = {
	components: "Components",
	tokens: "Tokens",
	assets: "Assets",
	icons: "Icons",
	lint: "Lint",
};
