import {
	clampResponsiveStageWidth,
	RESPONSIVE_STAGE_DEFAULT_WIDTH,
} from "../components/responsive-stage-context";
import type { ProjectQueryScope } from "../queries/project-scope";

const STORAGE_PREFIX = "trickroom:responsive-stage:v1";

type ResponsiveStageSessionState = {
	width: number;
};

type ResponsiveStageStorage = Pick<Storage, "getItem" | "setItem">;

const normalizeScope = (projectScope: ProjectQueryScope) => {
	const normalized =
		typeof projectScope === "string" ? projectScope.trim() : "";
	return normalized.length > 0 ? normalized : "default";
};

export function getResponsiveStageSessionStorageKey(
	projectScope: ProjectQueryScope,
	designFile: string | null | undefined,
) {
	const normalizedDesignFile =
		typeof designFile === "string" ? designFile.trim() : "";
	if (!normalizedDesignFile) {
		return null;
	}

	return [
		STORAGE_PREFIX,
		encodeURIComponent(normalizeScope(projectScope)),
		encodeURIComponent(normalizedDesignFile),
	].join(":");
}

export function readResponsiveStageSessionWidthFromStorage(
	storage: ResponsiveStageStorage,
	key: string | null,
) {
	if (!key) {
		return RESPONSIVE_STAGE_DEFAULT_WIDTH;
	}

	try {
		const raw = storage.getItem(key);
		if (!raw) {
			return RESPONSIVE_STAGE_DEFAULT_WIDTH;
		}

		const parsed = JSON.parse(raw) as Partial<ResponsiveStageSessionState>;
		return typeof parsed.width === "number" && Number.isFinite(parsed.width)
			? clampResponsiveStageWidth(parsed.width)
			: RESPONSIVE_STAGE_DEFAULT_WIDTH;
	} catch {
		return RESPONSIVE_STAGE_DEFAULT_WIDTH;
	}
}

export function writeResponsiveStageSessionWidthToStorage(
	storage: ResponsiveStageStorage,
	key: string | null,
	width: number,
) {
	if (!key) {
		return;
	}

	try {
		storage.setItem(
			key,
			JSON.stringify({ width: clampResponsiveStageWidth(width) }),
		);
	} catch {
		// Storage may be unavailable in private/restricted browser contexts. The
		// responsive editor remains usable; only the session preference is skipped.
	}
}

function getSessionStorage() {
	return typeof window !== "undefined" ? window.sessionStorage : null;
}

export function readResponsiveStageSessionWidth(
	projectScope: ProjectQueryScope,
	designFile: string | null | undefined,
) {
	const storage = getSessionStorage();
	if (!storage) {
		return RESPONSIVE_STAGE_DEFAULT_WIDTH;
	}

	return readResponsiveStageSessionWidthFromStorage(
		storage,
		getResponsiveStageSessionStorageKey(projectScope, designFile),
	);
}

export function writeResponsiveStageSessionWidth(
	projectScope: ProjectQueryScope,
	designFile: string | null | undefined,
	width: number,
) {
	const storage = getSessionStorage();
	if (!storage) {
		return;
	}

	writeResponsiveStageSessionWidthToStorage(
		storage,
		getResponsiveStageSessionStorageKey(projectScope, designFile),
		width,
	);
}
