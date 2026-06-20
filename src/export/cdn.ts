/**
 * Pinned CDN endpoints for the standalone export runtime.
 *
 * The ESM module graph (React, React-DOM, Base UI) is served by **esm.sh** with
 * `?external`, which makes every Base UI module import bare `react`/`react-dom`
 * so the import map can collapse them to a single React instance. jsDelivr's
 * `+esm` cannot do this (it hardcodes — and even duplicates — transitive React
 * versions), which crashes hooks. See the `project_html_export_cdn_runtime`
 * memory. Fonts are inlined from the system's font manifest (see `./fonts`), not
 * loaded from a CDN.
 *
 * Versions are pinned to what we run internally (`package.json`). Because esm.sh
 * externalizes React, the React pin here governs the whole graph — there is no
 * version-discovery dance.
 */

export const REACT_VERSION = "19.2.6";
export const BASE_UI_VERSION = "1.5.0";

const ESM = "https://esm.sh";

/** Import-map entries for the React runtime; React-DOM externalizes React to dedupe. */
export function reactImportMapEntries(): Record<string, string> {
	return {
		react: `${ESM}/react@${REACT_VERSION}`,
		"react/jsx-runtime": `${ESM}/react@${REACT_VERSION}/jsx-runtime`,
		"react-dom": `${ESM}/react-dom@${REACT_VERSION}?external=react`,
		"react-dom/client": `${ESM}/react-dom@${REACT_VERSION}/client?external=react`,
	};
}

/** esm.sh URL for a Base UI subpath, externalizing React so it shares our instance. */
export function baseUiImportUrl(subpath: string): string {
	return `${ESM}/@base-ui/react@${BASE_UI_VERSION}/${subpath}?external=react,react-dom`;
}
