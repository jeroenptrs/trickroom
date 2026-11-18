export type SystemEditorPage =
	| "components"
	| "tokens"
	| "assets"
	| "icons"
	| "lint";

/** The page a System editor URL opens: a component always means Components. */
export function getSystemEditorPage(
	tab: string | null,
	componentId: string | null,
): SystemEditorPage {
	if (componentId) {
		return "components";
	}

	if (
		tab === "tokens" ||
		tab === "assets" ||
		tab === "icons" ||
		tab === "lint"
	) {
		return tab;
	}

	return "components";
}
