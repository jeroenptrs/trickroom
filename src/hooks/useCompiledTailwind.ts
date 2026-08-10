/**
 * `compiled` render mode (the `@tailwindcss/browser` replacement, behind the
 * Tailwind render-mode flag).
 *
 * Scans the design iframe's DOM for the class names actually rendered
 * (`collectCandidates`), compiles the system's full stylesheet for them server-side
 * (`compile().build(candidates)` — preflight + theme `:root` vars + only the
 * used utilities), and injects the result as a plain `<style>`. A debounced
 * MutationObserver keeps it in sync as the design changes.
 *
 * No-op unless `isCompiledTailwindMode()`. In that mode `shell.html` does not
 * load the browser runtime, so this is the sole source of utility CSS.
 */

import { useQuery } from "@tanstack/react-query";
import { shallow, useSelector } from "@tanstack/react-store";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useProjectScope } from "../components/contexts";
import {
	getRenderableClassComposition,
	resolveRegistryComponent,
} from "../libraries/registry";
import {
	compileTailwindCss,
	storedTailwindTokensQueryOptions,
} from "../queries/tailwind-sync-tokens";
import { type DesignEntity, designStore } from "../stores/design-store";
import { isCompiledTailwindMode } from "../utils/tailwind-render-mode";
import { serializeTailwindThemeDomains } from "../utils/tailwind-theme-css";

const STYLE_ID = "trickroom-compiled-tailwind";
const FALLBACK_SCRIPT_ID = "trickroom-tailwind-browser-fallback";
const BROWSER_RUNTIME_SRC = "/tailwind/index.global.js";
const REBUILD_DEBOUNCE_MS = 120;

// Classes baked into shell.html (not produced by the rendered design tree).
const SHELL_SEED = [
	"w-full",
	"h-full",
	"overflow-hidden",
	"relative",
	"bg-[#ffffff]",
	"focus-visible:outline-0",
];
const EMPTY_CANDIDATES: string[] = [];

function addClassNameCandidates(candidates: Set<string>, className: string) {
	for (const token of className.split(/\s+/)) {
		if (token) candidates.add(token);
	}
}

export function collectDesignStoreCandidateClassNames(
	entitiesById: Record<string, DesignEntity>,
): string[] {
	const candidates = new Set<string>();

	for (const entity of Object.values(entitiesById)) {
		const resolution = resolveRegistryComponent(
			entity.props["data-trickroom-library"],
			entity.props["data-trickroom-component"],
		);
		const className =
			resolution.status === "known"
				? getRenderableClassComposition(entity.props, resolution.definition)
						.className
				: typeof entity.props.className === "string"
					? entity.props.className
					: undefined;

		if (className) {
			addClassNameCandidates(candidates, className);
		}
	}

	return [...candidates].sort();
}

/** DOM scan — only visible rendered nodes contribute candidates (see responsive one-board note in Artboards). */
export function collectCandidates(
	doc: Document,
	modelCandidates: readonly string[] = [],
): string[] {
	const candidates = new Set<string>(SHELL_SEED);
	for (const candidate of modelCandidates) {
		if (candidate) candidates.add(candidate);
	}
	for (const element of doc.querySelectorAll("[class]")) {
		const className = element.getAttribute("class");
		if (!className) continue;
		addClassNameCandidates(candidates, className);
	}
	return [...candidates].sort();
}

function upsertCompiledStyle(doc: Document, css: string) {
	const existing = doc.getElementById(STYLE_ID);
	if (existing instanceof HTMLStyleElement) {
		if (existing.textContent !== css) {
			existing.textContent = css;
		}
		return;
	}
	existing?.remove();
	const style = doc.createElement("style");
	style.id = STYLE_ID;
	style.setAttribute("data-trickroom-managed", "compiled-tailwind");
	style.textContent = css;
	doc.head.appendChild(style);
}

/**
 * Reveal the design content gated by `shell.html` (see
 * `markAwaitCompiledStyles`). Set once the first stylesheet — compiled or the
 * fallback runtime — is in place, so the canvas paints styled rather than
 * flashing raw class names.
 */
function revealStyledContent(doc: Document) {
	doc.documentElement.setAttribute("data-trickroom-styles-ready", "");
}

/**
 * Recovery path: if server-side compilation fails (e.g. the route is
 * unavailable), load the `@tailwindcss/browser` runtime into the iframe so the
 * design still renders. Injected once; the runtime then scans the DOM and
 * processes the injected `text/tailwindcss` theme like the default mode.
 */
function injectBrowserRuntimeFallback(doc: Document) {
	if (doc.getElementById(FALLBACK_SCRIPT_ID)) {
		return;
	}
	const script = doc.createElement("script");
	script.id = FALLBACK_SCRIPT_ID;
	script.src = BROWSER_RUNTIME_SRC;
	doc.head.appendChild(script);
}

export function useCompiledTailwind(
	iframeRef: RefObject<HTMLIFrameElement | null>,
	didMount: boolean,
	systemId: string | null | undefined,
) {
	const enabled = isCompiledTailwindMode();
	const [stylesReady, setStylesReady] = useState(!enabled);
	const normalized =
		typeof systemId === "string" && systemId.trim().length > 0
			? systemId.trim()
			: null;
	const projectScope = useProjectScope();

	// Falling back to the browser runtime is a session-level decision ("stop
	// compiling for the rest of the session"). Held in a ref so it survives the
	// effect re-running on dependency changes — otherwise a later rebuild could
	// inject compiled CSS *alongside* the already-loaded fallback runtime.
	const fellBackRef = useRef(false);

	// The editor's live theme (synced tokens + overrides), serialized as
	// `@theme { … }`, so token edits preview in compiled mode without a sync —
	// matching what the browser runtime gets from useInjectSystemTheme.
	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(normalized ?? "", projectScope),
		enabled: enabled && normalized !== null,
	});
	const themeOverrides = useMemo(() => {
		const stored = tokensQuery.data;
		if (!stored) return "";
		const css = serializeTailwindThemeDomains(
			stored.domains,
			stored.customProperties,
		);
		return css === "@theme {}" ? "" : css;
	}, [tokensQuery.data]);
	const designCandidateClassNames = useSelector(
		designStore,
		(state) =>
			enabled
				? collectDesignStoreCandidateClassNames(state.entitiesById)
				: EMPTY_CANDIDATES,
		{ compare: shallow },
	);

	useEffect(() => {
		// Runs even without a system: the server compiles baseline Tailwind so
		// the canvas is never left unstyled.
		if (!enabled || !didMount) {
			setStylesReady(!enabled && didMount);
			return;
		}
		const doc = iframeRef.current?.contentDocument;
		if (!doc) {
			return;
		}

		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let lastCandidateKey = "";
		// Monotonic id so a slow build for an older candidate set can't overwrite
		// the style tag after a newer build has already applied.
		let latestRequestId = 0;
		setStylesReady(false);

		const rebuild = async () => {
			if (fellBackRef.current) {
				return;
			}
			const candidates = collectCandidates(doc, designCandidateClassNames);
			const key = candidates.join(" ");
			if (key === lastCandidateKey) {
				return;
			}
			lastCandidateKey = key;
			const requestId = ++latestRequestId;
			try {
				const { css } = await compileTailwindCss({
					...(normalized ? { systemId: normalized } : {}),
					candidates,
					...(themeOverrides ? { themeOverrides } : {}),
				});
				// Drop the result if a newer build has since been requested (or
				// superseded this one) so stale CSS never clobbers fresher CSS.
				if (!cancelled && requestId === latestRequestId) {
					upsertCompiledStyle(doc, css);
					revealStyledContent(doc);
					setStylesReady(true);
				}
			} catch (error) {
				// Ignore a stale failure once a newer build is in flight.
				if (requestId !== latestRequestId) {
					return;
				}
				// Don't leave the canvas blank: fall back to the browser runtime
				// for the rest of the session and stop compiling.
				console.error(
					"[Trickroom] compiled Tailwind build failed; falling back to the browser runtime",
					error,
				);
				fellBackRef.current = true;
				if (!cancelled) {
					injectBrowserRuntimeFallback(doc);
					// The runtime compiles a beat later, but reveal now so a failed
					// compile never leaves the canvas hidden indefinitely.
					revealStyledContent(doc);
					setStylesReady(true);
				}
			}
		};

		const schedule = () => {
			clearTimeout(timer);
			timer = setTimeout(rebuild, REBUILD_DEBOUNCE_MS);
		};

		schedule();
		const observer = new MutationObserver(schedule);
		observer.observe(doc.documentElement, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => {
			cancelled = true;
			clearTimeout(timer);
			observer.disconnect();
		};
	}, [
		enabled,
		didMount,
		normalized,
		themeOverrides,
		designCandidateClassNames,
		iframeRef,
	]);

	return stylesReady;
}
