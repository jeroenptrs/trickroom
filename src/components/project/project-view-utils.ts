import type { TrickroomDesignSummary } from "../../types";

export const pluralize = (
	count: number,
	singular: string,
	plural = `${singular}s`,
) => (count === 1 ? singular : plural);

export const formatRelativeTime = (isoDate: string | null | undefined) => {
	if (!isoDate) {
		return "never";
	}

	const timestamp = Date.parse(isoDate);
	if (Number.isNaN(timestamp)) {
		return "unknown";
	}

	const elapsedSeconds = Math.max(
		0,
		Math.floor((Date.now() - timestamp) / 1000),
	);
	if (elapsedSeconds < 60) {
		return "just now";
	}

	const elapsedMinutes = Math.floor(elapsedSeconds / 60);
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes}m ago`;
	}

	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) {
		return `${elapsedHours}h ago`;
	}

	const elapsedDays = Math.floor(elapsedHours / 24);
	if (elapsedDays < 14) {
		return `${elapsedDays}d ago`;
	}

	const elapsedWeeks = Math.floor(elapsedDays / 7);
	if (elapsedWeeks < 8) {
		return `${elapsedWeeks}w ago`;
	}

	const elapsedMonths = Math.floor(elapsedDays / 30);
	if (elapsedMonths < 12) {
		return `${elapsedMonths}mo ago`;
	}

	const elapsedYears = Math.floor(elapsedDays / 365);
	return `${elapsedYears}y ago`;
};

export const getMostRecentModifiedAt = (
	summaries: TrickroomDesignSummary[] | undefined,
) =>
	summaries?.reduce<string | null>((mostRecent, summary) => {
		if (!summary.modifiedAt) {
			return mostRecent;
		}

		if (mostRecent === null || summary.modifiedAt > mostRecent) {
			return summary.modifiedAt;
		}

		return mostRecent;
	}, null) ?? null;
