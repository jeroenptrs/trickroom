import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDesignFileService } from "../services/design-file-service";
import type { TrickroomDesign } from "../types";

/**
 * Test access to stored designs without knowing their on-disk layout.
 */

/** A design as stored (with its `version`), assembled from its files. */
export const readStoredDesign = async (projectRoot: string, designId: string) =>
	(await createDesignFileService(projectRoot).readRawDesign(designId))
		.value as TrickroomDesign & { version?: number };

/** Path of the legacy single-file layout, `designs/<id>.json`. */
export const getLegacyDesignFilePath = (
	projectRoot: string,
	designId: string,
) => path.join(projectRoot, ".trickroom", "designs", `${designId}.json`);

/**
 * Writes a design in the legacy single-file layout, bypassing the service.
 * For fixtures the service would refuse to write, or that model files from
 * older Trickroom versions. `value` is written as given (strings verbatim).
 */
export const writeLegacyDesignFile = async (
	projectRoot: string,
	designId: string,
	value: unknown,
) => {
	const filePath = getLegacyDesignFilePath(projectRoot, designId);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(
		filePath,
		typeof value === "string" ? value : JSON.stringify(value, null, "\t"),
		"utf8",
	);
	return filePath;
};
