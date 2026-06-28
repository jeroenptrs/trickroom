import { createDesignFileService } from "../services/design-file-service";
import { normalizeAssetId, readAssetManifest } from "./asset-manifest-service";
import { findDesignSystem } from "./design-system-store";
import { normalizeIconId, readIconManifest } from "./icon-manifest-service";
import type { MemoryScope } from "./memory-manifest-service.types";
import { listSystemComponentSummaries } from "./system-component-operations";
import { readDomainTokensReadonly } from "./tailwind-token-store";

export const MEMORY_REFERENCE_TYPES = [
	"design",
	"component",
	"token",
	"asset",
	"icon",
] as const;

export type MemoryReferenceType = (typeof MEMORY_REFERENCE_TYPES)[number];

export type MemoryReferenceToken = {
	type: MemoryReferenceType;
	id: string;
	raw: string;
	start: number;
	end: number;
};

export type MemoryReferenceStatus = "valid" | "broken" | "unresolvable_scope";

export type ResolvedMemoryReference = MemoryReferenceToken & {
	status: MemoryReferenceStatus;
	label?: string;
	detail?: string;
	/** In-app route for valid targets (design editor or system editor). */
	deepLink?: string;
};

export type MemoryReferenceWarning = {
	raw: string;
	type: MemoryReferenceType;
	id: string;
	status: Exclude<MemoryReferenceStatus, "valid">;
	message: string;
};

// Matches {{type:id}} with optional surrounding whitespace. Bodies are stored
// verbatim; this only reads tokens for validation/resolution.
const REFERENCE_PATTERN =
	/\{\{\s*(design|component|token|asset|icon)\s*:\s*([^}]+?)\s*\}\}/g;

export function parseMemoryReferences(body: string): MemoryReferenceToken[] {
	const tokens: MemoryReferenceToken[] = [];
	REFERENCE_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null = REFERENCE_PATTERN.exec(body);
	while (match !== null) {
		const id = match[2]?.trim() ?? "";
		if (id.length > 0) {
			tokens.push({
				type: match[1] as MemoryReferenceType,
				id,
				raw: match[0],
				start: match.index,
				end: match.index + match[0].length,
			});
		}
		match = REFERENCE_PATTERN.exec(body);
	}
	return tokens;
}

type ReferenceSystemContext = {
	systemId: string;
	systemName: string;
};

/** Builds an in-app navigation path for a resolved reference target. */
export function buildMemoryReferenceDeepLink(
	type: MemoryReferenceType,
	targetId: string,
	systemId?: string | null,
): string | undefined {
	if (type === "design") {
		return `/design/${targetId}`;
	}
	if (!systemId) {
		return undefined;
	}
	const systemPath = `/system/${encodeURIComponent(systemId)}`;
	if (type === "component") {
		return `${systemPath}?component=${encodeURIComponent(targetId)}`;
	}
	if (type === "token") {
		return `${systemPath}?tab=tokens`;
	}
	if (type === "asset") {
		return `${systemPath}?tab=assets`;
	}
	return `${systemPath}?tab=icons`;
}

const withDeepLink = (
	reference: ResolvedMemoryReference,
	systemId?: string | null,
): ResolvedMemoryReference => {
	if (reference.status !== "valid") {
		return reference;
	}
	const deepLink = buildMemoryReferenceDeepLink(
		reference.type,
		reference.id,
		reference.type === "design" ? null : systemId,
	);
	return deepLink ? { ...reference, deepLink } : reference;
};

type MemoryReferenceContext = {
	system: ReferenceSystemContext | null;
	designIds: Set<string>;
	designLabels: Map<string, string>;
};

async function resolveContextSystem(
	projectRoot: string,
	scope: MemoryScope,
): Promise<ReferenceSystemContext | null> {
	if (scope.kind === "system") {
		const system = await findDesignSystem(projectRoot, scope.systemHandle);
		return system
			? {
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
				}
			: null;
	}

	if (scope.kind === "design") {
		const service = createDesignFileService(projectRoot);
		const summaries = await service.listDesignSummaries();
		const summary = summaries.find(
			(entry) => entry.uuid?.toLowerCase() === scope.designId.toLowerCase(),
		);
		const handle = summary?.systemId ?? summary?.systemName ?? null;
		if (!handle) {
			return null;
		}
		const system = await findDesignSystem(projectRoot, handle);
		return system
			? {
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
				}
			: null;
	}

	return null;
}

async function buildReferenceContext(
	projectRoot: string,
	scope: MemoryScope,
	tokens: MemoryReferenceToken[],
): Promise<MemoryReferenceContext> {
	const needsDesign = tokens.some((token) => token.type === "design");
	const designIds = new Set<string>();
	const designLabels = new Map<string, string>();
	if (needsDesign) {
		const service = createDesignFileService(projectRoot);
		const summaries = await service.listDesignSummaries();
		for (const summary of summaries) {
			if (summary.uuid) {
				const lower = summary.uuid.toLowerCase();
				designIds.add(lower);
				designLabels.set(lower, summary.name);
			}
		}
	}

	return {
		system: await resolveContextSystem(projectRoot, scope),
		designIds,
		designLabels,
	};
}

async function resolveSystemScopedReference(
	projectRoot: string,
	system: ReferenceSystemContext,
	token: MemoryReferenceToken,
): Promise<ResolvedMemoryReference> {
	if (token.type === "component") {
		const { components } = await listSystemComponentSummaries(
			projectRoot,
			system.systemId,
		);
		const match = components.find(
			(component) =>
				component.componentId === token.id || component.slug === token.id,
		);
		return withDeepLink(
			match
				? { ...token, status: "valid", label: match.name }
				: { ...token, status: "broken" },
			system.systemId,
		);
	}

	if (token.type === "token") {
		const stored = await readDomainTokensReadonly(projectRoot, system.systemId);
		const slashIndex = token.id.indexOf("/");
		const domain = slashIndex >= 0 ? token.id.slice(0, slashIndex) : null;
		const name = slashIndex >= 0 ? token.id.slice(slashIndex + 1) : token.id;
		const domains = stored?.domains as
			| Record<string, { tokens: Record<string, string> }>
			| undefined;
		const value =
			domain && name ? domains?.[domain]?.tokens?.[name] : undefined;
		if (value !== undefined) {
			return withDeepLink(
				{ ...token, status: "valid", label: name, detail: value },
				system.systemId,
			);
		}
		return withDeepLink({ ...token, status: "broken" }, system.systemId);
	}

	if (token.type === "asset") {
		const manifest = await readAssetManifest(projectRoot, system.systemId);
		const normalized = safeNormalize(
			() => normalizeAssetId(token.id),
			token.id,
		);
		const asset = manifest.assets[normalized];
		return withDeepLink(
			asset
				? { ...token, status: "valid", label: asset.name }
				: { ...token, status: "broken" },
			system.systemId,
		);
	}

	const manifest = await readIconManifest(projectRoot, system.systemId);
	const normalized = safeNormalize(() => normalizeIconId(token.id), token.id);
	const icon = manifest.icons[normalized];
	return withDeepLink(
		icon
			? { ...token, status: "valid", label: normalized }
			: { ...token, status: "broken" },
		system.systemId,
	);
}

const safeNormalize = (normalize: () => string, fallback: string): string => {
	try {
		return normalize();
	} catch {
		return fallback.trim();
	}
};

export async function resolveMemoryReferences(
	projectRoot: string,
	scope: MemoryScope,
	tokens: MemoryReferenceToken[],
): Promise<ResolvedMemoryReference[]> {
	if (tokens.length === 0) {
		return [];
	}

	const context = await buildReferenceContext(projectRoot, scope, tokens);
	const resolved: ResolvedMemoryReference[] = [];

	for (const token of tokens) {
		if (token.type === "design") {
			const lower = token.id.toLowerCase();
			resolved.push(
				withDeepLink(
					context.designIds.has(lower)
						? {
								...token,
								status: "valid",
								label: context.designLabels.get(lower),
							}
						: { ...token, status: "broken" },
				),
			);
			continue;
		}

		if (!context.system) {
			resolved.push({ ...token, status: "unresolvable_scope" });
			continue;
		}

		resolved.push(
			await resolveSystemScopedReference(projectRoot, context.system, token),
		);
	}

	return resolved;
}

export type MemoryReferenceTarget = {
	id: string;
	label: string;
	detail?: string;
};

const matchesQuery = (query: string, ...fields: (string | undefined)[]) => {
	if (query.length === 0) return true;
	const needle = query.toLowerCase();
	return fields.some((field) => field?.toLowerCase().includes(needle));
};

/**
 * Returns candidate reference targets for intellisense in a given scope. Design
 * targets are available everywhere; component/token/asset/icon targets require a
 * contextual system (the design's linked system or the system scope itself).
 */
export async function listMemoryReferenceTargets(
	projectRoot: string,
	scope: MemoryScope,
	type: MemoryReferenceType,
	query = "",
	limit = 50,
): Promise<MemoryReferenceTarget[]> {
	const trimmedQuery = query.trim();

	if (type === "design") {
		const service = createDesignFileService(projectRoot);
		const summaries = await service.listDesignSummaries();
		return summaries
			.filter((summary) => summary.uuid)
			.filter((summary) =>
				matchesQuery(trimmedQuery, summary.uuid ?? "", summary.name),
			)
			.slice(0, limit)
			.map((summary) => ({
				id: summary.uuid as string,
				label: summary.name,
			}));
	}

	const system = await resolveContextSystem(projectRoot, scope);
	if (!system) {
		return [];
	}

	if (type === "component") {
		const { components } = await listSystemComponentSummaries(
			projectRoot,
			system.systemId,
		);
		return components
			.filter((component) =>
				matchesQuery(
					trimmedQuery,
					component.componentId,
					component.name,
					component.slug,
				),
			)
			.slice(0, limit)
			.map((component) => ({
				id: component.componentId,
				label: component.name,
				detail: component.slug,
			}));
	}

	if (type === "token") {
		const stored = await readDomainTokensReadonly(projectRoot, system.systemId);
		const domains = stored?.domains as
			| Record<string, { tokens: Record<string, string> }>
			| undefined;
		if (!domains) return [];
		const targets: MemoryReferenceTarget[] = [];
		for (const [domain, domainStorage] of Object.entries(domains)) {
			for (const [name, value] of Object.entries(domainStorage.tokens)) {
				const id = `${domain}/${name}`;
				if (matchesQuery(trimmedQuery, id, name)) {
					targets.push({ id, label: name, detail: value });
				}
			}
		}
		return targets.slice(0, limit);
	}

	if (type === "asset") {
		const manifest = await readAssetManifest(projectRoot, system.systemId);
		return Object.entries(manifest.assets)
			.filter(([id, asset]) => matchesQuery(trimmedQuery, id, asset.name))
			.slice(0, limit)
			.map(([id, asset]) => ({ id, label: asset.name }));
	}

	const manifest = await readIconManifest(projectRoot, system.systemId);
	return Object.keys(manifest.icons)
		.filter((id) => matchesQuery(trimmedQuery, id))
		.slice(0, limit)
		.map((id) => ({ id, label: id }));
}

const warningMessage = (reference: ResolvedMemoryReference): string | null => {
	if (reference.status === "valid") {
		return null;
	}
	if (reference.status === "unresolvable_scope") {
		return `Reference ${reference.raw} cannot be resolved: this scope is not linked to a design system.`;
	}
	return `Reference ${reference.raw} does not resolve to an existing ${reference.type}.`;
};

/**
 * Parses + resolves references in a note body and returns non-blocking warnings
 * for anything that does not resolve. Bodies remain stored verbatim regardless.
 */
/** Resolves every `{{type:id}}` token in a note body for read-side diagnostics. */
export async function resolveMemoryNoteReferences(
	projectRoot: string,
	scope: MemoryScope,
	body: string,
): Promise<ResolvedMemoryReference[]> {
	const tokens = parseMemoryReferences(body);
	if (tokens.length === 0) {
		return [];
	}
	return resolveMemoryReferences(projectRoot, scope, tokens);
}

export async function collectMemoryReferenceWarnings(
	projectRoot: string,
	scope: MemoryScope,
	body: string,
): Promise<MemoryReferenceWarning[]> {
	const tokens = parseMemoryReferences(body);
	if (tokens.length === 0) {
		return [];
	}

	const resolved = await resolveMemoryReferences(projectRoot, scope, tokens);
	const warnings: MemoryReferenceWarning[] = [];
	for (const reference of resolved) {
		const message = warningMessage(reference);
		if (message && reference.status !== "valid") {
			warnings.push({
				raw: reference.raw,
				type: reference.type,
				id: reference.id,
				status: reference.status,
				message,
			});
		}
	}
	return warnings;
}
