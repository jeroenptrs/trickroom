export const TRICKROOM_DEEPLINK_PREFIX = "trickroom://proj/";

export const isTrickroomDeeplinkUrl = (value: string) =>
	value.startsWith(TRICKROOM_DEEPLINK_PREFIX);

export const normalizeTrickroomDeeplinkUrl = (value: string) => {
	const trimmed = value.trim();
	try {
		return decodeURIComponent(trimmed);
	} catch {
		return trimmed;
	}
};

export const findTrickroomDeeplinkInArgs = (args: string[]) => {
	for (const arg of args) {
		const normalized = normalizeTrickroomDeeplinkUrl(arg);
		if (isTrickroomDeeplinkUrl(normalized)) {
			return normalized;
		}
	}

	return null;
};
