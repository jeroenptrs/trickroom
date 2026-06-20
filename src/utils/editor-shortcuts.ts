import { useEffect } from "react";

export type ShortcutPlacementIntent = "after" | "before" | "inside";

const editableTags = new Set(["INPUT", "SELECT", "TEXTAREA"]);
const editableRoles = new Set(["combobox", "searchbox", "textbox"]);

export function isEditableShortcutTarget(target: EventTarget | null) {
	if (!(target instanceof Element)) {
		return false;
	}

	if (target.closest("[data-shortcuts-disabled]")) {
		return true;
	}

	if (target.closest('[contenteditable="true"]')) {
		return true;
	}

	if (editableTags.has(target.tagName)) {
		return true;
	}

	const role = target.getAttribute("role");
	return role ? editableRoles.has(role) : false;
}

export function hasOpenShortcutBlockingSurface() {
	return Boolean(
		document.querySelector('[role="dialog"], [data-shortcuts-disabled]'),
	);
}

export function getShortcutPlacementIntent(
	event: Pick<KeyboardEvent | MouseEvent, "altKey" | "shiftKey">,
): ShortcutPlacementIntent {
	if (event.altKey) return "inside";
	if (event.shiftKey) return "before";
	return "after";
}

export function getKey(event: KeyboardEvent) {
	return event.key.toLowerCase();
}

export function isPeriodKey(event: KeyboardEvent) {
	return event.code === "Period";
}

export function isShortcutLetter(event: KeyboardEvent, letter: string) {
	const normalizedLetter = letter.toLowerCase();
	if (event.altKey) {
		return event.code === `Key${normalizedLetter.toUpperCase()}`;
	}

	return getKey(event) === normalizedLetter;
}

export function hasCommandModifier(event: KeyboardEvent) {
	return event.metaKey || event.ctrlKey;
}

export function useWindowKeyDown(
	handler: (event: KeyboardEvent) => void,
	options: {
		enabled?: boolean;
		ignoreEditableTargets?: boolean;
		ignoreBlockingSurfaces?: boolean;
	} = {},
) {
	const {
		enabled = true,
		ignoreEditableTargets = true,
		ignoreBlockingSurfaces = true,
	} = options;

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (ignoreEditableTargets && isEditableShortcutTarget(event.target)) {
				return;
			}
			if (ignoreBlockingSurfaces && hasOpenShortcutBlockingSurface()) {
				return;
			}
			handler(event);
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [enabled, handler, ignoreBlockingSurfaces, ignoreEditableTargets]);
}

export function focusEditorRegion(region: "rail" | "workspace" | "inspector") {
	const target = document.querySelector<HTMLElement>(
		`[data-editor-region="${region}"]`,
	);
	target?.focus();
}
