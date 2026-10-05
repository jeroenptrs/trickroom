import type { TrickroomDesign } from "../../types";
import { readAssetManifest } from "../../utils/asset-manifest-service";
import {
	type DesignSystemRecord,
	findDesignSystem,
	listDesignSystems,
} from "../../utils/design-system-store";
import { readIconManifest } from "../../utils/icon-manifest-service";
import { readMemoryManifest } from "../../utils/memory-manifest-service";
import type { MemoryScope } from "../../utils/memory-manifest-service.types";
import { readSystemComponentManifest } from "../../utils/system-component-manifest-service";
import type { SystemComponentRecord } from "../../utils/system-components";
import { readDomainTokensReadonly } from "../../utils/tailwind-token-store";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import {
	getDesignSystemHandle,
	readDesignFileForTool,
} from "../payloads/design-tree";
import { getGovernanceSummary } from "../payloads/project";
import type { TrickroomMcpServerContext } from "../server-types";

/**
 * Project facts shared by the authoring contract core and its topics. Every
 * read is lazy and memoized: a topic call reads only what that topic shows.
 */

const memo = <T>(load: () => Promise<T>) => {
	let pending: Promise<T> | undefined;
	return () => {
		pending ??= load();
		return pending;
	};
};

const orNull = async <T>(load: Promise<T>) => {
	try {
		return await load;
	} catch {
		return null;
	}
};

export type GuideSystem = {
	systemId: string;
	systemName: string;
	/** "design" when linked to the requested design, else the project default. */
	source: "design" | "project-default";
	record: DesignSystemRecord;
};

export type DesignGuideInput = ReturnType<typeof createDesignGuideInput>;

export const createDesignGuideInput = (
	context: TrickroomMcpServerContext,
	options: { designFileId?: string; library?: string; name?: string } = {},
) => {
	const policy = getMcpPolicy(context.config);
	if (options.designFileId !== undefined) {
		assertCanReadDesignFile(policy, options.designFileId);
	}
	const { projectRoot } = context;

	const readDesign = memo(async () =>
		options.designFileId === undefined
			? null
			: readDesignFileForTool(context, options.designFileId),
	);

	const readSystem = memo(async (): Promise<GuideSystem | null> => {
		const design = await readDesign();
		const handle = design
			? getDesignSystemHandle(design.design)
			: (context.config.defaultSystemId ?? null);
		const record = handle ? await findDesignSystem(projectRoot, handle) : null;
		return record
			? {
					systemId: record.manifest.systemId,
					systemName: record.manifest.systemName,
					source: design ? "design" : "project-default",
					record,
				}
			: null;
	});

	const readTokenCounts = memo(async () => {
		const system = await readSystem();
		const stored = system
			? await orNull(readDomainTokensReadonly(projectRoot, system.systemId))
			: null;
		if (!stored) {
			return null;
		}
		const domains: Record<string, number> = {};
		for (const [domain, storage] of Object.entries(stored.domains)) {
			const count = Object.keys(storage.tokens).length;
			if (count > 0) {
				domains[domain] = count;
			}
		}
		return { domains, reviewRequired: stored.metadata.reviewRequired };
	});

	const readPublishedComponents = memo(
		async (): Promise<SystemComponentRecord[]> => {
			const system = await readSystem();
			const read = system
				? await orNull(
						readSystemComponentManifest(projectRoot, system.systemId),
					)
				: null;
			return Object.values(read?.manifest.components ?? {})
				.filter((component) => component.published !== undefined)
				.sort(
					(left, right) =>
						(left.group ?? "").localeCompare(right.group ?? "") ||
						(left.order ?? 0) - (right.order ?? 0) ||
						left.slug.localeCompare(right.slug),
				);
		},
	);

	const readResourceCounts = memo(async () => {
		const system = await readSystem();
		if (!system) {
			return null;
		}
		const [assets, icons] = await Promise.all([
			orNull(readAssetManifest(projectRoot, system.systemId)),
			orNull(readIconManifest(projectRoot, system.systemId)),
		]);
		return {
			assets: assets ? Object.keys(assets.assets).length : 0,
			icons: icons ? Object.keys(icons.icons).length : 0,
		};
	});

	const countNotes = async (scope: MemoryScope) => {
		const read = await orNull(readMemoryManifest(projectRoot, scope));
		return read ? Object.keys(read.manifest.notes).length : 0;
	};

	const readMemoryCounts = memo(async () => {
		const system = await readSystem();
		const [design, systemNotes, project] = await Promise.all([
			options.designFileId === undefined
				? null
				: countNotes({ kind: "design", designId: options.designFileId }),
			system
				? countNotes({ kind: "system", systemHandle: system.systemId })
				: null,
			countNotes({ kind: "project" }),
		]);
		return {
			...(design === null ? {} : { design }),
			...(systemNotes === null ? {} : { system: systemNotes }),
			project,
		};
	});

	return {
		context,
		policy,
		designFileId: options.designFileId,
		filter: { library: options.library, name: options.name },
		readDesign,
		readSystem,
		readTokenCounts,
		readPublishedComponents,
		readResourceCounts,
		readMemoryCounts,
	};
};

const MAX_LISTED_BOARDS = 8;
const MAX_LISTED_COMPONENTS = 40;

const summarizeBoards = (design: TrickroomDesign) => ({
	boardCount: design.boards.length,
	boards: design.boards.slice(0, MAX_LISTED_BOARDS).map((board) => ({
		id: board.id,
		name: board.props["data-trickroom-name"] ?? null,
	})),
});

/** Small, project-specific facts for the contract core. */
export const buildDesignCoreFacts = async (input: DesignGuideInput) => {
	const { context } = input;
	const [design, system, memory] = await Promise.all([
		input.readDesign(),
		input.readSystem(),
		input.readMemoryCounts(),
	]);
	const [tokens, components, resources] = system
		? await Promise.all([
				input.readTokenCounts(),
				input.readPublishedComponents(),
				input.readResourceCounts(),
			])
		: [null, [], null];
	const otherSystems = system
		? []
		: (await listDesignSystems(context.projectRoot)).map(
				(record) => record.manifest.systemName,
			);

	return {
		governance: getGovernanceSummary(input.policy),
		...(design === null
			? {}
			: {
					design: {
						id: input.designFileId,
						name: design.design.name,
						revision: design.revision,
						...summarizeBoards(design.design),
					},
				}),
		designSystem:
			system === null
				? {
						linked: false,
						note:
							design === null
								? "No default design system. Pass designFileId for the design's linked system."
								: "This design has no linked design system: classes are checked against plain Tailwind only and no tokens, components, assets or icons are available.",
						...(otherSystems.length > 0
							? { configuredSystems: otherSystems }
							: {}),
					}
				: {
						systemId: system.systemId,
						systemName: system.systemName,
						linked: system.source === "design" ? true : "project default",
						tokens: tokens?.domains ?? null,
						...(tokens?.reviewRequired ? { tokenReviewRequired: true } : {}),
						components: {
							published: components.length,
							slugs: components
								.slice(0, MAX_LISTED_COMPONENTS)
								.map((component) => component.slug),
						},
						assets: resources?.assets ?? 0,
						icons: resources?.icons ?? 0,
					},
		memoryNotes: memory,
	};
};
