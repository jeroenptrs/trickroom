import { useQuery } from "@tanstack/react-query";
import { type RefObject, useEffect } from "react";
import { useProjectScope } from "../components/contexts";
import {
	type SystemFontsResponse,
	systemFontsQueryOptions,
} from "../queries/system-fonts";
import {
	buildSystemFontInjectionPlan,
	managedFontFileUrl,
	managedStylesheetLinkId,
	projectFontFileUrl,
	systemFontsStyleId,
} from "../utils/font-injection";
import type { FontSource } from "../utils/font-manifest-service";

function describeFontSource(systemId: string, source: FontSource) {
	switch (source.kind) {
		case "remoteStylesheet":
			return {
				kind: source.kind,
				url: source.url,
			};
		case "remoteFile":
			return {
				kind: source.kind,
				url: source.url,
				format: source.format,
			};
		case "projectFile":
			return {
				kind: source.kind,
				path: source.path,
				servedUrl: projectFontFileUrl(systemId, source.path),
				format: source.format,
			};
		case "managedFile":
			return {
				kind: source.kind,
				path: source.path,
				servedUrl: managedFontFileUrl(systemId, source.path),
				format: source.format,
			};
	}
}

function logSystemFontInjection(
	systemId: string,
	data: SystemFontsResponse,
	plan: ReturnType<typeof buildSystemFontInjectionPlan>,
) {
	console.groupCollapsed(
		`[Trickroom fonts] Injecting ${data.fonts.length} font source entr${data.fonts.length === 1 ? "y" : "ies"} for system "${systemId}"`,
	);
	if (data.fonts.length === 0) {
		console.log(
			"No fonts.json source entries found. Font tokens/classes can still exist, but custom faces need font sources to be registered before the iframe can load them.",
		);
	}
	console.log("Stylesheet URLs", plan.stylesheetUrls);
	console.log("Font-face CSS", plan.fontFaceCss || "(none)");
	for (const font of data.fonts) {
		console.groupCollapsed(
			`Font ${font.id}: ${font.family} (${font.faces.length} face${font.faces.length === 1 ? "" : "s"})`,
		);
		for (const [faceIndex, face] of font.faces.entries()) {
			console.log(`Face ${faceIndex + 1}`, {
				style: face.style,
				weight: face.weight,
				display: face.display,
				sources: face.sources.map((source) =>
					describeFontSource(systemId, source),
				),
			});
		}
		console.groupEnd();
	}
	console.groupEnd();
}

function upsertManagedFontStyle(document: Document, css: string) {
	const existing = document.getElementById(systemFontsStyleId);

	if (existing instanceof HTMLStyleElement) {
		if (existing.textContent !== css) {
			existing.textContent = css;
		}
		return;
	}

	existing?.remove();

	const style = document.createElement("style");
	style.id = systemFontsStyleId;
	style.setAttribute("data-trickroom-managed", "system-fonts");
	style.textContent = css;
	document.head.appendChild(style);
}

function syncStylesheetLinks(document: Document, urls: readonly string[]) {
	const managedLinks = [
		...document.head.querySelectorAll(
			'link[data-trickroom-managed="system-font-stylesheet"]',
		),
	];
	for (const link of managedLinks) {
		link.remove();
	}

	for (const [index, url] of urls.entries()) {
		const link = document.createElement("link");
		link.id = managedStylesheetLinkId(index);
		link.rel = "stylesheet";
		link.href = url;
		link.setAttribute("data-trickroom-managed", "system-font-stylesheet");
		document.head.appendChild(link);
	}
}

/**
 * Injects registered font sources into the design iframe as normal CSS
 * (`<link rel="stylesheet">` and a managed `<style>` with `@font-face` rules).
 *
 * Mirrors {@link useInjectSystemTheme} and {@link useInjectSystemAssets}.
 */
export function useInjectSystemFonts(
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

	const fontsQuery = useQuery({
		...systemFontsQueryOptions(normalized ?? "", projectScope),
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
			syncStylesheetLinks(iframeDoc, []);
			upsertManagedFontStyle(iframeDoc, "");
			return;
		}

		const data = fontsQuery.data;
		if (!data) {
			if (fontsQuery.isFetched) {
				syncStylesheetLinks(iframeDoc, []);
				upsertManagedFontStyle(iframeDoc, "");
			}
			return;
		}

		const plan = buildSystemFontInjectionPlan(normalized, data);
		logSystemFontInjection(normalized, data, plan);
		syncStylesheetLinks(iframeDoc, plan.stylesheetUrls);
		upsertManagedFontStyle(iframeDoc, plan.fontFaceCss);
	}, [
		iframeRef,
		didMount,
		enabled,
		normalized,
		fontsQuery.data,
		fontsQuery.isFetched,
	]);

	return didMount && (!enabled || fontsQuery.isFetched);
}
