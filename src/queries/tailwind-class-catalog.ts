import { queryOptions } from "@tanstack/react-query";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type TailwindClassCatalogResponse = {
	systemId: string | null;
	/** Utility class names in Tailwind's own order (no variants). */
	classes: string[];
	/** Variant names usable as `name:` prefixes. */
	variants: string[];
};

export type TailwindClassInspection = {
	candidate: string;
	supported: boolean;
	suggestions?: string[];
};

/**
 * Every utility and variant the system's compiled Tailwind design system
 * knows (baseline Tailwind without a system). Large but stable: the server
 * caches the design system, and file events invalidate this on token syncs.
 */
export const tailwindClassCatalogQueryOptions = (
	systemId: string | null,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: withProjectQueryScope(
			["trickroom-tailwind-class-catalog", systemId ?? ""],
			projectScope,
		),
		queryFn: async () => {
			const query = systemId ? `?systemId=${encodeURIComponent(systemId)}` : "";
			const response = await fetch(
				`/api/trickroom/tailwind/class-catalog${query}`,
			);
			return readJsonOrThrow<TailwindClassCatalogResponse>(response);
		},
		staleTime: 5 * 60_000,
	});

/** Which classes the system's Tailwind compiles, with nearest matches. */
export const tailwindClassInspectQueryOptions = (
	systemId: string | null,
	candidates: readonly string[],
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: withProjectQueryScope(
			["trickroom-tailwind-class-inspect", systemId ?? "", ...candidates],
			projectScope,
		),
		queryFn: async () => {
			const response = await fetch("/api/trickroom/tailwind/class-inspect", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...(systemId ? { systemId } : {}),
					candidates,
				}),
			});
			return readJsonOrThrow<{ results: TailwindClassInspection[] }>(response);
		},
		staleTime: 5 * 60_000,
	});
