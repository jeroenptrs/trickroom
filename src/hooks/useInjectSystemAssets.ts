import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect } from "react";
import { useProjectScope } from "../components/contexts";
import { systemAssetsQueryOptions } from "../queries/system-assets";
import { serializeAssetImageVars } from "../utils/asset-background";

const MANAGED_STYLE_ID = "trickroom-system-assets";
const EMPTY_ASSET_CSS = ":root {}";

function upsertManagedAssetStyle(document: Document, css: string) {
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
	style.setAttribute("data-trickroom-managed", "system-assets");
	style.textContent = css;
	document.head.appendChild(style);
}

/**
 * Injects a managed `<style>` into the design iframe defining one CSS custom
 * property per system asset (`--asset-<id>: url(...)`), so the Background
 * control can bind background-image to an asset by id via
 * `bg-(image:--asset-<id>)` rather than baking the file URL into the class.
 *
 * Mirrors {@link useInjectSystemTheme}: keyed on the active `systemId`, updated
 * in place, and reset to an empty `:root {}` when unlinked.
 */
export function useInjectSystemAssets(
	iframeRef: RefObject<HTMLIFrameElement | null>,
	didMount: boolean,
	systemId: string | null | undefined,
) {
	const normalized =
		typeof systemId === "string" && systemId.trim().length > 0
			? systemId
			: null;
	const enabled = normalized !== null;
	const projectScope = useProjectScope();

	const assetsQuery = useQuery({
		...systemAssetsQueryOptions(normalized ?? "", projectScope),
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
			upsertManagedAssetStyle(iframeDoc, EMPTY_ASSET_CSS);
			return;
		}

		const data = assetsQuery.data;
		if (!data) {
			if (assetsQuery.isFetched) {
				upsertManagedAssetStyle(iframeDoc, EMPTY_ASSET_CSS);
			}
			return;
		}

		const css = serializeAssetImageVars(
			normalized,
			data.assets.map((asset) => asset.id),
		);
		upsertManagedAssetStyle(iframeDoc, css);
	}, [
		iframeRef,
		didMount,
		enabled,
		normalized,
		assetsQuery.data,
		assetsQuery.isFetched,
	]);

	return didMount && (!enabled || assetsQuery.isFetched);
}
