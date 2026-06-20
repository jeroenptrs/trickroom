/**
 * How the design iframe gets its Tailwind CSS.
 *
 * - `compiled` (default): Trickroom compiles the stylesheet server-side via the
 *   keeper engine (`compile().build(candidates)`) from the classes actually
 *   rendered, and injects it. Resilient — falls back to baseline Tailwind when
 *   a design has no system, and to the browser runtime if a compile fails (see
 *   `useCompiledTailwind`), so the canvas is never left blank.
 * - `browser` (escape hatch): the bundled `@tailwindcss/browser` runtime scans
 *   the iframe DOM and compiles utilities live. The original path.
 *
 * Opt back into the browser runtime with `VITE_TAILWIND_RENDER_MODE=browser` at
 * build time, or flip `window.__TRICKROOM_TAILWIND_RENDER_MODE__ = "browser"`
 * before load for a quick runtime check.
 */

export type TailwindRenderMode = "browser" | "compiled";

function resolveTailwindRenderMode(): TailwindRenderMode {
	if (
		typeof window !== "undefined" &&
		(window as { __TRICKROOM_TAILWIND_RENDER_MODE__?: string })
			.__TRICKROOM_TAILWIND_RENDER_MODE__ === "browser"
	) {
		return "browser";
	}
	const env = import.meta.env as Record<string, string | undefined> | undefined;
	return env?.VITE_TAILWIND_RENDER_MODE === "browser" ? "browser" : "compiled";
}

export const TAILWIND_RENDER_MODE: TailwindRenderMode =
	resolveTailwindRenderMode();

export const isCompiledTailwindMode = (): boolean =>
	TAILWIND_RENDER_MODE === "compiled";

const BROWSER_RUNTIME_SCRIPT =
	/[\t ]*<script[^>]*src="\/tailwind\/index\.global\.js"[^>]*><\/script>\s*/i;

/** Remove the `@tailwindcss/browser` runtime `<script>` from shell HTML. */
export function stripBrowserRuntimeScript(stageDocRaw: string): string {
	return stageDocRaw.replace(BROWSER_RUNTIME_SCRIPT, "");
}

/**
 * Mark the shell so its design content stays hidden until compiled CSS lands.
 * The shell's gate rule keys off `data-trickroom-await-styles`; only compiled
 * mode opts in, so the browser runtime path stays visible by default.
 * `useCompiledTailwind` reveals the content by setting
 * `data-trickroom-styles-ready` on the same element.
 */
export function markAwaitCompiledStyles(stageDocRaw: string): string {
	return stageDocRaw.replace(/<html\b/i, "<html data-trickroom-await-styles");
}

/**
 * The iframe shell HTML, with the `@tailwindcss/browser` runtime `<script>`
 * removed in `compiled` mode (where `useCompiledTailwind` injects the CSS and
 * the runtime would otherwise double-generate utilities from the DOM), and the
 * reveal-on-ready gate enabled so the canvas never flashes unstyled content.
 */
export function resolveStageDoc(stageDocRaw: string): string {
	return isCompiledTailwindMode()
		? markAwaitCompiledStyles(stripBrowserRuntimeScript(stageDocRaw))
		: stageDocRaw;
}
