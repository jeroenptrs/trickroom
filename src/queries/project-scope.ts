export type ProjectQueryScope = string | null | undefined;

export type ProjectQueryScopeSource = {
	locationId?: string | null;
	projectId?: string | null;
	projectRoot?: string | null;
};

const normalizeProjectQueryScope = (scope: ProjectQueryScope) => {
	const normalized = typeof scope === "string" ? scope.trim() : "";
	return normalized.length > 0 ? normalized : undefined;
};

export const getProjectQueryScope = (
	project: ProjectQueryScopeSource | null | undefined,
) =>
	normalizeProjectQueryScope(
		project?.locationId ?? project?.projectId ?? project?.projectRoot,
	);

export const withProjectQueryScope = (
	queryKey: readonly unknown[],
	projectScope?: ProjectQueryScope,
) => {
	const normalized = normalizeProjectQueryScope(projectScope);
	return normalized ? [...queryKey, normalized] : [...queryKey];
};
