/**
 * Export descriptor registry.
 *
 * Maps a Trickroom registry id (`library/component`) to how it is rendered in a
 * standalone exported HTML file, which talks to RAW `@base-ui/react` from a CDN
 * (not our wrapper components in `src/libraries/base-ui/*`, which depend on app
 * internals). The exported runtime imports each base-ui namespace once per
 * subpath and accesses parts as `Namespace.Member`.
 *
 * The base-ui namespace import names come from the wrapper import lines in
 * `src/libraries/base-ui/*.tsx` (e.g. `import { Accordion } from
 * "@base-ui/react/accordion"`). Almost all are regular PascalCase of the
 * subpath; the irregular case is `otp-field`, whose base-ui export is
 * `OTPFieldPreview`. The id set and roles are owned by the registries
 * (`src/libraries/base-ui/registry.ts`, `trickroom/registry.ts`); this table is
 * the one mapping no registry file carries, so a test validates it covers every
 * base-ui subpath present in the registry (drift guard). Because the export
 * renders against raw `@base-ui/react`, it can cover registry ids whose live
 * render wrappers don't exist yet (e.g. `dialog.*` / `alert-dialog.*`).
 */

export type ExportDescriptor =
	| { kind: "intrinsic"; tag: string }
	| { kind: "icon" }
	| { kind: "base-ui"; subpath: string; importName: string; member?: string };

/**
 * base-ui subpath -> the named export of `@base-ui/react/<subpath>`.
 * Mirrors the `from "@base-ui/react/<subpath>"` imports across the wrappers.
 */
const BASE_UI_NAMESPACE_IMPORTS: Record<string, string> = {
	accordion: "Accordion",
	"alert-dialog": "AlertDialog",
	avatar: "Avatar",
	button: "Button",
	checkbox: "Checkbox",
	"checkbox-group": "CheckboxGroup",
	collapsible: "Collapsible",
	combobox: "Combobox",
	"context-menu": "ContextMenu",
	dialog: "Dialog",
	drawer: "Drawer",
	field: "Field",
	fieldset: "Fieldset",
	form: "Form",
	input: "Input",
	menu: "Menu",
	menubar: "Menubar",
	meter: "Meter",
	"number-field": "NumberField",
	"otp-field": "OTPFieldPreview",
	popover: "Popover",
	"preview-card": "PreviewCard",
	progress: "Progress",
	radio: "Radio",
	"radio-group": "RadioGroup",
	"scroll-area": "ScrollArea",
	select: "Select",
	separator: "Separator",
	slider: "Slider",
	switch: "Switch",
	tabs: "Tabs",
	toggle: "Toggle",
	"toggle-group": "ToggleGroup",
	toolbar: "Toolbar",
	tooltip: "Tooltip",
};

const TRICKROOM_DESCRIPTORS: Record<string, ExportDescriptor> = {
	container: { kind: "intrinsic", tag: "div" },
	text: { kind: "intrinsic", tag: "div" },
	asset: { kind: "intrinsic", tag: "img" },
	icon: { kind: "icon" },
};

function pascalCase(kebab: string): string {
	return kebab
		.split("-")
		.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
		.join("");
}

/**
 * Resolve a registry id to its export descriptor, or `null` if the id is not
 * renderable in a standalone export (mirrors the live renderer returning
 * `unknown-component`).
 */
export function resolveExportDescriptor(
	library: string,
	component: string,
): ExportDescriptor | null {
	if (library === "trickroom") {
		return TRICKROOM_DESCRIPTORS[component] ?? null;
	}

	if (library === "base-ui") {
		const dot = component.indexOf(".");
		const subpath = dot === -1 ? component : component.slice(0, dot);
		const importName = BASE_UI_NAMESPACE_IMPORTS[subpath];
		if (!importName) {
			return null;
		}
		const member =
			dot === -1 ? undefined : pascalCase(component.slice(dot + 1));
		return { kind: "base-ui", subpath, importName, member };
	}

	return null;
}

/** The JS expression a base-ui descriptor renders as, e.g. `Dialog.Popup` or `Button`. */
export function baseUiAccessExpression(
	descriptor: Extract<ExportDescriptor, { kind: "base-ui" }>,
): string {
	return descriptor.member
		? `${descriptor.importName}.${descriptor.member}`
		: descriptor.importName;
}

/** The bare import specifier (import-map key) for a base-ui subpath. */
export function baseUiImportSpecifier(subpath: string): string {
	return `@base-ui/react/${subpath}`;
}
