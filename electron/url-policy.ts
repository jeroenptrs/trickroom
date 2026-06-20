export const isAllowedAppUrl = (candidate: string, allowedOrigin: string) => {
	try {
		const url = new URL(candidate);
		return url.origin === allowedOrigin;
	} catch {
		return false;
	}
};

export const isSafeExternalUrl = (candidate: string) => {
	try {
		const url = new URL(candidate);
		return url.protocol === "https:" || url.protocol === "mailto:";
	} catch {
		return false;
	}
};
