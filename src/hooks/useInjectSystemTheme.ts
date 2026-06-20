import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect } from "react";
import { storedTailwindTokensQueryOptions } from "../queries/tailwind-sync-tokens";
import { serializeTailwindTheme } from "../utils/tailwind-theme-css";

const MANAGED_STYLE_ID = "trickroom-system-theme";
const EMPTY_THEME_CSS = "@theme {}";

function upsertManagedThemeStyle(document: Document, css: string) {
	const existing = document.getElementById(MANAGED_STYLE_ID);

	if (existing instanceof HTMLStyleElement) {
		if (existing.textContent !== css) {
			existing.textContent = css;
		}
		return;
	}

	existing?.remove();

	const style = document.createElement("style");
	style.id = MANAGED_STYLE_ID;
	style.setAttribute("type", "text/tailwindcss");
	style.setAttribute("data-trickroom-managed", "system-theme");
	style.textContent = css;
	document.head.appendChild(style);
}

/**
 * When a design has a linked `systemName`, fetches the stored Tailwind tokens
 * for that system and injects a single managed `<style type="text/tailwindcss">`
 * element into the design iframe's `<head>`. The element is updated in place on
 * data changes and reset to an empty theme when the design is unlinked.
 *
 * Note: Tailwind browser may not recompile dynamically inserted
 * `text/tailwindcss` style tags after its initial load pass. This hook only
 * manages the DOM injection; downstream Tailwind processing is out of scope.
 */
export function useInjectSystemTheme(
	iframeRef: RefObject<HTMLIFrameElement | null>,
	didMount: boolean,
	systemName: string | null | undefined,
) {
	const normalized =
		typeof systemName === "string" && systemName.trim().length > 0
			? systemName
			: null;
	const enabled = normalized !== null;

	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(normalized ?? ""),
		enabled,
	});

	useEffect(() => {
		if (!didMount) {
			return;
		}
		const iframeDoc = iframeRef.current?.contentDocument;
		if (!iframeDoc) {
			return;
		}

		if (!enabled) {
			upsertManagedThemeStyle(iframeDoc, EMPTY_THEME_CSS);
			return;
		}

		const stored = tokensQuery.data;
		if (!stored) {
			// Missing or 404: leave any prior injection alone until we know.
			// If switched to a new system that has no stored tokens, reset
			// the managed style so Tailwind observes a source change and rebuilds.
			if (tokensQuery.isFetched) {
				upsertManagedThemeStyle(iframeDoc, EMPTY_THEME_CSS);
			}
			return;
		}

		const css = serializeTailwindTheme(
			stored.domains.color.tokens,
			stored.domains.color.overrides,
		);

		upsertManagedThemeStyle(iframeDoc, css);
	}, [
		iframeRef,
		didMount,
		enabled,
		tokensQuery.data,
		tokensQuery.isFetched,
	]);
}
