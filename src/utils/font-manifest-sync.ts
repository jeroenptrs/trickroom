import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TrickroomConfig } from "../types.ts";
import { findDesignSystem } from "./design-system-store.ts";
import type { InferredFontCandidate } from "./font-source-inference.ts";
import { inferFontSourcesFromSystemStylesheet } from "./font-source-inference.ts";
import {
	type FontFace,
	type FontManifest,
	type FontManifestFont,
	readFontManifest,
	registerFont,
	updateFont,
} from "./font-manifest-service.ts";

import type { FontSourceInferenceDiagnostic } from "./font-source-inference.ts";

export type FontManifestSyncResult = {
	manifest: FontManifest;
	addedFontIds: string[];
	updatedFontIds: string[];
	skippedFontIds: string[];
	diagnostics: FontSourceInferenceDiagnostic[];
};

export type SyncFontsFromSystemStylesheetOptions = {
	onlyWhenEmpty?: boolean;
};

function faceSignature(face: FontFace): string {
	return `${face.style}:${face.weight}:${face.sources
		.map((source) => JSON.stringify(source))
		.join("|")}`;
}

function mergeFaces(left: FontFace[], right: FontFace[]): FontFace[] {
	const merged = [...left];
	for (const face of right) {
		if (!merged.some((entry) => faceSignature(entry) === faceSignature(face))) {
			merged.push(face);
		}
	}
	return merged;
}

export async function mergeInferredFontsIntoManifest(
	projectRoot: string,
	systemHandle: string,
	candidates: InferredFontCandidate[],
): Promise<{
	manifest: FontManifest;
	addedFontIds: string[];
	updatedFontIds: string[];
	skippedFontIds: string[];
}> {
	const manifest = await readFontManifest(projectRoot, systemHandle);
	const addedFontIds: string[] = [];
	const updatedFontIds: string[] = [];
	const skippedFontIds: string[] = [];
	let nextManifest = manifest;

	for (const candidate of candidates) {
		const existing = nextManifest.fonts[candidate.fontId];
		if (!existing) {
			const registered = await registerFont(projectRoot, systemHandle, {
				fontId: candidate.fontId,
				name: candidate.name,
				family: candidate.family,
				faces: candidate.faces,
			});
			nextManifest = registered.manifest;
			addedFontIds.push(candidate.fontId);
			continue;
		}

		const mergedFaces = mergeFaces(existing.faces, candidate.faces);
		if (mergedFaces.length === existing.faces.length) {
			skippedFontIds.push(candidate.fontId);
			continue;
		}

		const updated = await updateFont(projectRoot, systemHandle, candidate.fontId, {
			faces: mergedFaces,
		});
		nextManifest = updated.manifest;
		updatedFontIds.push(candidate.fontId);
	}

	return {
		manifest: nextManifest,
		addedFontIds,
		updatedFontIds,
		skippedFontIds,
	};
}

export async function syncFontsFromSystemStylesheet(
	projectRoot: string,
	systemHandle: string,
	options: SyncFontsFromSystemStylesheetOptions = {},
): Promise<FontManifestSyncResult> {
	const record = await findDesignSystem(projectRoot, systemHandle);
	if (!record) {
		throw new Error(`Unknown design system "${systemHandle}".`);
	}

	const cssPath = await resolveSystemStylesheetCssPath(projectRoot, record);
	if (!cssPath) {
		const manifest = await readFontManifest(projectRoot, systemHandle);
		return {
			manifest,
			addedFontIds: [],
			updatedFontIds: [],
			skippedFontIds: [],
			diagnostics: [],
		};
	}

	const existingManifest = await readFontManifest(projectRoot, systemHandle);
	if (
		options.onlyWhenEmpty &&
		Object.keys(existingManifest.fonts).length > 0
	) {
		return {
			manifest: existingManifest,
			addedFontIds: [],
			updatedFontIds: [],
			skippedFontIds: [],
			diagnostics: [],
		};
	}

	const inference = await inferFontSourcesFromSystemStylesheet(projectRoot, cssPath);
	if (inference.candidates.length === 0) {
		return {
			manifest: existingManifest,
			addedFontIds: [],
			updatedFontIds: [],
			skippedFontIds: [],
			diagnostics: inference.diagnostics,
		};
	}

	const merged = await mergeInferredFontsIntoManifest(
		projectRoot,
		systemHandle,
		inference.candidates,
	);

	return {
		...merged,
		diagnostics: inference.diagnostics,
	};
}

async function resolveSystemStylesheetCssPath(
	projectRoot: string,
	record: Awaited<ReturnType<typeof findDesignSystem>>,
): Promise<string | null> {
	const manifestCssPath = record?.manifest.cssPath?.trim();
	if (manifestCssPath) {
		return manifestCssPath;
	}

	if (!record) {
		return null;
	}

	try {
		const configPath = path.join(projectRoot, "trickroom.config.json");
		const config = JSON.parse(
			await readFile(configPath, "utf8"),
		) as TrickroomConfig;
		const legacyCssPath = config.systems?.[record.manifest.systemName]?.trim();
		return legacyCssPath && legacyCssPath.length > 0 ? legacyCssPath : null;
	} catch {
		return null;
	}
}
