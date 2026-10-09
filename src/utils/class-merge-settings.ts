import { resolveCodegenConfig } from "../codegen/config";
import type { TrickroomConfig } from "../types";
import {
	buildComponentClassTable,
	type ClassMergeSettings,
	type ComponentClassMerge,
} from "./class-merge";
import { findDesignSystem } from "./design-system-store";
import { readSystemComponentManifest } from "./system-component-manifest-service";
import {
	resolveConfiguredTailwindSystemTarget,
	TailwindSystemResolutionError,
} from "./tailwind-design-system";
import { loadDerivedTwMerge } from "./tailwind-merge-derive";

/**
 * How the canvas and the HTML export merge the component classes of a design
 * linked to `systemId`, the way the project's code does (see
 * `ClassMergeSettings`):
 *
 * - No system, or one that does not resolve: `none`.
 * - `codegen.twMerge` generates the config for this system: `derived`, with
 *   the project's merge groups, like `trickroom lint`. When the config cannot
 *   be derived (the CSS fails to compile, the merge groups do not fit),
 *   `none` with the error: stock tailwind-merge would remove classes the
 *   project's own config keeps.
 * - Otherwise `stock`, which `tv()` merges with by default.
 *
 * The derived config comes from `loadDerivedTwMerge`, cached per compiled
 * design system until the system's CSS files change.
 */
export const resolveClassMergeSettings = async ({
	projectRoot,
	config,
	systemId,
}: {
	projectRoot: string;
	config: TrickroomConfig;
	systemId: string | null;
}): Promise<ClassMergeSettings> => {
	if (!systemId?.trim()) return { mode: "none" };

	let system: Awaited<ReturnType<typeof resolveConfiguredTailwindSystemTarget>>;
	try {
		system = await resolveConfiguredTailwindSystemTarget(projectRoot, config, {
			systemId: systemId.trim(),
		});
	} catch (error) {
		if (error instanceof TailwindSystemResolutionError) {
			return { mode: "none" };
		}
		throw error;
	}

	const codegen = resolveCodegenConfig(config);
	if (codegen.status !== "configured" || !codegen.twMerge) {
		return { mode: "stock" };
	}
	const target = codegen.system
		? await findDesignSystem(projectRoot, codegen.system, { readOnly: true })
		: null;
	if (codegen.system && target?.manifest.systemId !== system.systemId) {
		return { mode: "stock" };
	}

	try {
		const derived = await loadDerivedTwMerge(
			{ projectRoot, cssPath: system.cssPath },
			codegen.twMerge.mergeGroups,
		);
		return { mode: "derived", config: derived.config };
	} catch (error) {
		return {
			mode: "none",
			error: `The tailwind-merge config could not be derived, so classes are not merged: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
};

/**
 * `resolveClassMergeSettings` plus, when classes merge, the class data of the
 * system's components under the resolved system id. A component manifest
 * that cannot be read leaves them out: instances then render their stored
 * className.
 */
export const resolveComponentClassMerge = async (options: {
	projectRoot: string;
	config: TrickroomConfig;
	systemId: string | null;
}): Promise<ComponentClassMerge> => {
	const settings = await resolveClassMergeSettings(options);
	if (settings.mode === "none" || !options.systemId?.trim()) return settings;
	const system = await resolveConfiguredTailwindSystemTarget(
		options.projectRoot,
		options.config,
		{ systemId: options.systemId.trim() },
	);
	try {
		const read = await readSystemComponentManifest(
			options.projectRoot,
			system.systemId,
			{ readOnly: true },
		);
		return {
			...settings,
			components: {
				systemId: system.systemId,
				table: buildComponentClassTable(read.manifest),
			},
		};
	} catch (error) {
		// Instances then render their stored className; say why.
		console.warn(
			`[Trickroom] component classes of system "${system.systemId}" not resolved, the component manifest could not be read:`,
			error,
		);
		return settings;
	}
};
