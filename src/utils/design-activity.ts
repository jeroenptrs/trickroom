import type { ProjectQueryScope } from "../queries/project-scope";
import type { TrickroomDesignSummary } from "../types";

/**
 * When this browser last opened each design, for the project screen's
 * "recent" order.
 *
 * Design ids are globally unique, so one browser-wide map keyed by design id
 * holds every project's history: switching git worktrees or branches (a
 * different project scope for the same designs) keeps it. Older versions
 * kept one map per project scope (`trickroom:design-activity:<scope>`); the
 * current scope's map is still read and merged in, and the merged history is
 * written to the browser-wide key only.
 */
const designActivityStorageKey = "trickroom:design-activity";
const legacyDesignActivityStoragePrefix = `${designActivityStorageKey}:`;

/** Opened designs kept, most recent first. */
const maxDesignActivityEntries = 1000;

type DesignActivityMap = Record<string, string>;

const getLegacyStorageKey = (projectScope?: ProjectQueryScope) =>
	`${legacyDesignActivityStoragePrefix}${projectScope || "default"}`;

const readActivityMap = (key: string): DesignActivityMap => {
	try {
		const raw = window.localStorage.getItem(key);
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

const isLater = (candidate: string, current: string | undefined) =>
	current === undefined || Date.parse(candidate) > Date.parse(current);

const readDesignActivity = (
	projectScope?: ProjectQueryScope,
): DesignActivityMap => {
	if (typeof window === "undefined") {
		return {};
	}

	const activity = readActivityMap(designActivityStorageKey);
	for (const [uuid, openedAt] of Object.entries(
		readActivityMap(getLegacyStorageKey(projectScope)),
	)) {
		if (isLater(openedAt, activity[uuid])) {
			activity[uuid] = openedAt;
		}
	}
	return activity;
};

const writeDesignActivity = (activity: DesignActivityMap) => {
	const entries = Object.entries(activity)
		.sort(([, left], [, right]) => Date.parse(right) - Date.parse(left))
		.slice(0, maxDesignActivityEntries);
	try {
		window.localStorage.setItem(
			designActivityStorageKey,
			JSON.stringify(Object.fromEntries(entries)),
		);
	} catch {
		// Storage full or unavailable: the order falls back to edit times.
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
	if (isLater(openedAt, activity[uuid])) {
		activity[uuid] = openedAt;
	}
	writeDesignActivity(activity);
};

const toTime = (value: string | undefined) => {
	const time = value ? Date.parse(value) : Number.NaN;
	return Number.isNaN(time) ? 0 : time;
};

const getActivityTime = (
	activity: DesignActivityMap,
	design: TrickroomDesignSummary,
) => Math.max(toTime(design.modifiedAt), toTime(activity[design.uuid]));

/**
 * The later of when the design last changed (`modifiedAt`, see
 * `TrickroomDesignSummary`) and when this browser last opened it.
 */
export const getDesignActivityTimestamp = (
	projectScope: ProjectQueryScope,
	design: TrickroomDesignSummary,
) => getActivityTime(readDesignActivity(projectScope), design);

export const sortDesignsByRecentActivity = (
	designs: readonly TrickroomDesignSummary[],
	projectScope: ProjectQueryScope,
) => {
	const activity = readDesignActivity(projectScope);
	const times = new Map(
		designs.map((design) => [design, getActivityTime(activity, design)]),
	);
	return [...designs].sort((left, right) => {
		const activityDelta = (times.get(right) ?? 0) - (times.get(left) ?? 0);
		if (activityDelta !== 0) {
			return activityDelta;
		}

		return left.name.localeCompare(right.name);
	});
};
