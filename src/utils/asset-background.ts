/**
 * Helpers for using a trickroom system asset as a CSS background image.
 *
 * An asset id resolves to the same file endpoint the `<Asset>` component uses.
 * Rather than baking that URL into the className, the runtime injects a CSS
 * custom property per asset (`--asset-<id>: url(...)`) into the design iframe
 * (see `useInjectSystemAssets`), and the Background control writes a clean,
 * id-bound utility `bg-(image:--asset-<id>)`.
 */

/** File endpoint for an asset — mirrors `libraries/trickroom/asset.tsx`. */
export function assetFileUrl(systemId: string, assetId: string): string {
	return `/api/trickroom/systems/${encodeURIComponent(systemId)}/assets/${encodeURIComponent(assetId)}/file`;
}

/** CSS custom-property name holding an asset's `url()` for background-image. */
export function assetImageVarName(assetId: string): string {
	const safe = assetId.replace(/[^a-zA-Z0-9_-]/g, "-");
	// CSS-safe ids map to themselves (no collision possible). Ids that needed
	// sanitizing (e.g. path-separated "a/b" vs "a-b") get a short deterministic
	// hash suffix so distinct ids never share a variable name.
	if (safe === assetId) {
		return `--asset-${safe}`;
	}
	return `--asset-${safe}-${hashAssetId(assetId)}`;
}

/** Small deterministic (FNV-1a) hash, base36, for disambiguating asset ids. */
function hashAssetId(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

/**
 * Tailwind utility body binding background-image to an asset's injected var.
 *
 * Uses the bracketed `[image:var(--x)]` form (not the `(image:--x)` shorthand)
 * because the color classifier rejects bracketed non-color values, so this
 * lands in the `background.background-image` slot and coexists with a separate
 * background color rather than being swallowed as a color custom property.
 */
export function assetImageUtility(assetId: string): string {
	return `bg-[image:var(${assetImageVarName(assetId)})]`;
}

/**
 * The value the style model stores for {@link assetImageUtility}, used to
 * detect which asset (if any) the current background-image references.
 */
export function assetImageSlotValue(assetId: string): string {
	return `[image:var(${assetImageVarName(assetId)})]`;
}

/** Serializes a `:root` block defining `--asset-*` vars for the given assets. */
export function serializeAssetImageVars(
	systemId: string,
	assetIds: readonly string[],
): string {
	if (assetIds.length === 0) {
		return ":root {}";
	}
	const lines = assetIds.map(
		(assetId) =>
			`\t${assetImageVarName(assetId)}: url("${assetFileUrl(systemId, assetId)}");`,
	);
	return `:root {\n${lines.join("\n")}\n}`;
}
