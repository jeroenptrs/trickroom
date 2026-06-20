import type { ProjectQueryScope } from "../queries/project-scope";
import type { TrickroomDesignSummary } from "../types";

const designActivityStoragePrefix = "trickroom:design-activity:";

type DesignActivityMap = Record<string, string>;

const getStorageKey = (projectScope?: ProjectQueryScope) =>
	`${designActivityStoragePrefix}${projectScope || "default"}`;

const readDesignActivity = (
	projectScope?: ProjectQueryScope,
): DesignActivityMap => {
	if (typeof window === "undefined") {
		return {};
	}

	try {
		const raw = window.localStorage.getItem(getStorageKey(projectScope));
		if (!raw) {
			return {};
		}

		const value = JSON.parse(raw);
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return {};
		}

		return Object.fromEntries(
			Object.entries(value).filter(
				([uuid, openedAt]) =>
					typeof uuid === "string" &&
					typeof openedAt === "string" &&
					!Number.isNaN(Date.parse(openedAt)),
			),
		) as DesignActivityMap;
	} catch {
		return {};
	}
};

export const getDesignLastOpenedAt = (
	projectScope: ProjectQueryScope,
	uuid: string,
) => readDesignActivity(projectScope)[uuid];

export const markDesignOpened = (
	projectScope: ProjectQueryScope,
	uuid: string,
	openedAt = new Date().toISOString(),
) => {
	if (typeof window === "undefined") {
		return;
	}

	const activity = readDesignActivity(projectScope);
	activity[uuid] = openedAt;
	window.localStorage.setItem(
		getStorageKey(projectScope),
		JSON.stringify(activity),
	);
};

export const getDesignActivityTimestamp = (
	projectScope: ProjectQueryScope,
	design: TrickroomDesignSummary,
) => {
	const modifiedTime = Date.parse(design.modifiedAt);
	const openedAt = getDesignLastOpenedAt(projectScope, design.uuid);
	const openedTime = openedAt ? Date.parse(openedAt) : Number.NaN;
	return Math.max(
		Number.isNaN(modifiedTime) ? 0 : modifiedTime,
		Number.isNaN(openedTime) ? 0 : openedTime,
	);
};

export const sortDesignsByRecentActivity = (
	designs: readonly TrickroomDesignSummary[],
	projectScope: ProjectQueryScope,
) =>
	[...designs].sort((left, right) => {
		const activityDelta =
			getDesignActivityTimestamp(projectScope, right) -
			getDesignActivityTimestamp(projectScope, left);
		if (activityDelta !== 0) {
			return activityDelta;
		}

		return left.name.localeCompare(right.name);
	});
